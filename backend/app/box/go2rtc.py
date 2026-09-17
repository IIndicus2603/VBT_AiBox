from app import config
from app.box.client import box

import http.client, json, os, re, subprocess, time
from urllib.parse import urlencode
from urllib.parse import unquote

GO2RTC     = config.GO2RTC
HERE       = config.HERE
GO2RTC_EXE = config.GO2RTC_EXE
GO2RTC_LOG = config.GO2RTC_LOG
GO2RTC_LOCAL = config.GO2RTC_LOCAL


def go2rtc(method, path, body=None):
    conn = http.client.HTTPConnection(GO2RTC, timeout=10)
    try:
        conn.request(method, path, body, {'Content-Type': 'application/json'})
        r = conn.getresponse()
        return r.status, r.read()
    finally:
        conn.close()


def _go2rtc_up():
    """True khi :1984 tra loi. Tai dung go2rtc() de khong them import socket."""
    try:
        go2rtc('GET', '/api/streams')
        return True
    except (OSError, http.client.HTTPException):
        return False


def _spawn_go2rtc():
    """go2rtc.exe doc go2rtc.yaml theo CWD -> cwd=HERE la bat buoc. Thieu no thi
    go2rtc van bind :1984 (watchdog tuong la song) nhung khong co stream nao."""
    if not os.path.exists(GO2RTC_EXE):
        print(f'! khong thay {GO2RTC_EXE}\n  -> tu chay go2rtc o {GO2RTC}')
        return False
    log = open(GO2RTC_LOG, 'ab', buffering=0)
    try:
        kw = {'cwd': HERE, 'stdin': subprocess.DEVNULL, 'stdout': log, 'stderr': log}
        if os.name == 'nt':
            kw['creationflags'] = 0x08000000      # CREATE_NO_WINDOW
        subprocess.Popen([GO2RTC_EXE], **kw)
    finally:
        log.close()      # con da dup handle roi, dong ban cua cha cho khoi ro
    return True


def go2rtc_watchdog():
    """Bridge :8090 con song -> :1984 phai song. go2rtc chet (hoac chua ai mo) thi
    tu khoi dong lai. Thread daemon: chet theo bridge, khong ngan bridge thoat."""
    fail = 0
    while True:
        if not GO2RTC_LOCAL or _go2rtc_up():
            fail = 0
            time.sleep(15)
            continue
        fail += 1
        # ponytail: 3 lan lien tiep ma van chet = exe/yaml hong, spawn mai chi lam
        # day go2rtc.log. Lui 5 phut roi thu lai de nguoi dung sua xong khoi restart.
        if fail > 3:
            print(f'! go2rtc khong day duoc {fail - 1} lan lien tiep -> tam ngung, xem {GO2RTC_LOG}')
            fail = 0
            time.sleep(300)
            continue
        print(f'go2rtc khong song o {GO2RTC} -> mo {os.path.basename(GO2RTC_EXE)}')
        _spawn_go2rtc()
        time.sleep(5)       # cho no bind :1984 truoc khi vong ke tiep kiem tra lai


def _creds_from_go2rtc(streams):
    """{ip: 'user:pass'} suy ra tu cac stream DA khai trong go2rtc.yaml.

    TAI LIEU noi box khong bao gio tra mat khau camera (chi `pwd` RSA, mot chieu),
    NHUNG firmware that ECS_B501_SF-B1103.6.5.260211 thi CO: /channel/list tra ve
    `rtsp://admin:<mat khau cleartext>@...` — 8/8 channel trong chl.json deu vay.
    Nen ham nay la FALLBACK cho firmware tra URL TRAN khong credential: _with_creds()
    uu tien credential co san trong rtsp truoc, chi dung den day khi URL khong co '@'.

    He qua bao mat: /aibox/channel/list lam lo mat khau camera dang cleartext. Truoc
    day chan duoc nho _local_only() (moi route ngoai /alarm chi nhan localhost).
    _local_only() gio DA MO LAN -> mat khau camera lo cho ca mang.

    HAI duong ro ri, ca hai deu tra URL tran:
      1. GET /aibox/channel/list  (route nay, di qua box)
      2. GET :1984/api/streams    (go2rtc tra thang tu go2rtc.yaml)
    Bit lai thi mask o ca hai; khong lien quan gi den dang nhap."""
    out = {}
    for o in (streams or {}).values():
        for p in (o.get('producers') or []):
            m = re.match(r'^rtsp://([^:@/]+:[^@/]*)@([^:/]+)', p.get('url') or '')
            if m:
                out.setdefault(m.group(2), m.group(1))
    return out


def _esc_userinfo(rtsp):
    """'%' tran trong user:pass -> %25. Firmware that tra 'UNV123456%@...' (khong
    escape) trong khi Dahua tra 'Dahua123456%25@...' (da escape) -> go2rtc bao
    "invalid URL escape" va stream chet. Chi sua trong phan userinfo truoc '@',
    khong cham path/query (subtype=1 phai giu nguyen)."""
    return re.sub(r'^(rtsp://)([^@/]*)@',
                  lambda m: m.group(1) + re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', m.group(2)) + '@',
                  rtsp)


def _with_creds(rtsp, ch, creds):
    """Chen user:pass vao rtsp tran. Thu tu uu tien: credential da biet cho dung IP
    do -> username tu /channel/list + mat khau cua box. '%' phai thanh %25 khong
    thi go2rtc parse URL fail ("invalid URL escape")."""
    if not rtsp.startswith('rtsp://'):
        return rtsp, 'nguyen ban'
    if '@' in rtsp.split('://', 1)[1].split('/')[0]:
        return _esc_userinfo(rtsp), 'nguyen ban'   # box da co credential, chi escape
    host = rtsp.split('://', 1)[1].split('/')[0].split(':')[0]
    ui = creds.get(host) or creds.get(ch.get('ip') or '')
    src = 'go2rtc.yaml'
    if not ui:
        return rtsp, 'thieu mat khau'
    user, _, pw = ui.partition(':')
    esc = lambda s: re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', s)
    return rtsp.replace('rtsp://', f'rtsp://{esc(user)}:{esc(pw)}@', 1), src


def _orphans(names, chans, cap):
    """Box la source of truth: moi luong go2rtc khong co channel tuong ung tren box
    la ruong -> dong bo thi xoa het. Nguoi dung them camera bang cach tao channel
    (app.js: POST /api/channel/add roi dat ten ch<channel_id>), nen luong ten khac
    chi con la do _probe/thu tay de lai. Tru duong dang bat dau bang '_': testUrl
    tao `_probe_<ms>` song thoang qua, xoa giua chung se lam bai test hong.
    cap = pagesize cua /channel/list: tra dung cap nghia la danh sach co the bi cat,
    xoa luc do la xoa oan camera dang chay -> tra rong."""
    if len(chans) >= cap:
        return []
    live = {f'ch{c.get("channel_id")}' for c in chans}
    return sorted(n for n in names if not n.startswith('_') and n not in live)


def sync_streams(prune=True):
    """/channel/list -> them stream vao go2rtc. Ten stream = ch<channel_id> nen
    UI ghep channel_id <-> stream khong can map tay. prune=True (nut "Dong bo
    camera") con xoa luong mo coi cua channel da bi bo tren box -> 2 chieu."""
    pagesize = 100
    r = box.call('/api/v2/channel/list', {'page': 1, 'pagesize': pagesize})
    if r.get('code') != 0:
        return r
    _, cur = go2rtc('GET', '/api/streams')
    streams = json.loads(cur or b'{}')
    creds = _creds_from_go2rtc(streams)

    added, kept, noauth, removed = [], [], [], []
    # doc dung ca 'channel_list' (theo tai lieu) va 'list' (mot so firmware)
    chans = r.get('data', {}).get('channel_list') or r.get('data', {}).get('list') or []
    for ch in chans:
        name, raw = f'ch{ch.get("channel_id")}', ch.get('rtsp') or ''
        if not raw:
            continue
        if name in streams:
            kept.append(name)
            continue
        src, how = _with_creds(raw, ch, creds)
        if how == 'thieu mat khau':
            # Van them: co the camera khong doi auth, hoac nguoi dung se sua sau.
            noauth.append({'name': name, 'ip': ch.get('ip'), 'rtsp': raw})
        go2rtc('PUT', '/api/streams?' + urlencode({'name': name, 'src': src}))
        added.append(name)
    # Chieu nguoc lai: channel da xoa tren box -> luong ch<id> cu phai bien mat,
    # neu khong no treo mai trong grid nhu mot camera chet. Box tra ve 0 channel
    # (dang khoi dong / mat mang thoang) thi dung xoa: thau het ca bang.
    if prune and chans:
        for nm in _orphans(streams, chans, pagesize):
            st, _ = go2rtc('DELETE', '/api/streams?' + urlencode({'src': nm}))
            if st < 300:
                removed.append(nm)
    return {'code': 0, 'added': added, 'kept': kept, 'removed': removed,
            'noauth': noauth,
            'channels': [{'channel_id': c.get('channel_id'), 'name': c.get('channel_name'),
                          'ip': c.get('ip'), 'status': c.get('status'),
                          'model': c.get('model')} for c in chans]}