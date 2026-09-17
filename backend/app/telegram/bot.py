"""Telegram: vong poll getUpdates + xu ly lenh tu nhom.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _TG_UPD_LOCK (aibox.py:799)
  - _tg_discover (aibox.py:1030-1055)
  - _tg_chat_info (aibox.py:1058-1078)
  - _tg_countpeople (aibox.py:1081-1132)
  - _tg_setup (aibox.py:1135-1183)
  - _tg_check (aibox.py:1186-1201)
  - _tg_send_video (aibox.py:1204-1227)
  - _tg_handle_command (aibox.py:1230-1252)
  - _tg_collect (aibox.py:1255-1272)
  - _tg_poll (aibox.py:1275-1312)
Imports: config; send (_tg_post, _tg_chat_lock); caption (_tg_log_tail, _tg_video,
_tg_video_url); c27 (_c27_hm, _c27_load, _C27_LOCK); alarm.receiver (_AREA,
_area_last, _box_channels, _box_area_enabled); db.repos. Registry nhom (tg_groups)
doc/ghi qua repos thay vi tg_groups.json; /setup luu vao config.CONN + repos.ConfigRepo.
"""
import json
import re
import threading
import time
from urllib.request import Request, urlopen

from app import config
from app.alarm.receiver import _AREA, _area_last, _box_area_enabled, _box_channels
from app.db import repos
from app.telegram.c27 import _C27_LOCK, _c27_hm, _c27_load
from app.telegram.caption import _tg_log_tail, _tg_video, _tg_video_url
from app.telegram.send import _tg_chat_lock, _tg_post

# Lock chung cho MỌI getUpdates (poll + discover). Telegram chi cho 1 getUpdates
# dong thoi moi token — 2 request song song -> 409 Conflict. Poll long-poll giu
# lock lau, discover chien lock ngan; ai toi truoc thi duoc goi.
_TG_UPD_LOCK = threading.Lock()
# Nghi giua 2 lan getUpdates. Telegram van tinh phien long-poll TRUOC la dang chay
# vai giay sau khi no tra ve, nen ban lien tuc = 409 xen ke thanh cong (do that tren
# token nay: nghi 1s -> 2/4 lan 409; nghi 4s -> 4/4 ok). Khong nghi thi bot chi poll
# duoc ~18s/lan (8s long-poll + 409 + ngu 10s) -> lenh /setup, /video tre toi 20s.
_TG_POLL_GAP = 4


def _tg_discover():
    """getUpdates -> gom moi chat bot thay vao registry. KHONG gui offset nen
    update van con cho lan doc sau (Telegram giu ~24h; registry giu lau hon)."""
    tok = config.CONN.get('tg_token')
    if not tok:
        return [], 'Chua dien bot token'
    seen = repos.TgGroupsRepo.load()
    try:
        # Lock tranh 409 voi poll long-poll. Neu poll dang giu (>12s), bo qua
        # getUpdates de khong treo HTTP handler — registry da co du lieu gui ve.
        if not _TG_UPD_LOCK.acquire(timeout=12):
            return list(seen.values()), None
        try:
            r = json.loads(urlopen(
                Request(f'https://api.telegram.org/bot{tok}/getUpdates'), timeout=15).read() or b'{}')
        finally:
            _TG_UPD_LOCK.release()
        if not r.get('ok'):
            return list(seen.values()), r.get('description', 'getUpdates loi')
        for upd in r.get('result') or []:
            _tg_collect(seen, upd)
    except Exception as e:
        print('[tg] discover that bai:', e)
        return list(seen.values()), str(e)
    repos.TgGroupsRepo.save(seen)
    return list(seen.values()), None


def _tg_chat_info(cid):
    """getChat -> (ten that, id chuan). Dung de nhap Chat ID thủ công: getUpdates
    khong bao gio thay nhom "im lang" (khong ai nhan 24h), nen ID tay la con duong
    DUY NHAT them duoc nhom do. getChat tra ten de nguoi dung xac nhan dung nhom,
    VA id chuan (canonical): supergroup thuong phai dung dang -100... (id "xem duoc"
    trong URL co the la id cu, gui vao se HTTP 400 Bad Request). Tra id chuan ve
    de UI luu id chuan thay vi giu id nguoi dung go."""
    tok = config.CONN.get('tg_token')
    if not tok:
        return '', '', 'Chua dien bot token'
    try:
        r = json.loads(urlopen(
            Request(f'https://api.telegram.org/bot{tok}/getChat?chat_id={cid}'), timeout=15).read() or b'{}')
        if not r.get('ok'):
            return '', '', r.get('description', 'getChat loi')
        ch = r.get('result') or {}
        name = ch.get('title') or ch.get('username') or ch.get('first_name') or cid
        cid_canon = ch.get('id') or cid
        return name, str(cid_canon), None
    except Exception as e:
        return '', '', str(e)


def _tg_countpeople(args, chat):
    """Tra loi /countpeople. HOI box truc tiep: /api/v2/smart/enable/list -> camera nao
    bat thuật toán dem nguoi (AreaRuleData). args: 'ch1,ch2' = nguoi tung camera do;
    '' = cac camera CO BAT dem nguoi tren box; 'sum' = tong nguoi cac camera do.
    So nguoi lay tu _AREA (box chi PUSH AreaRuleData real-time, khong co API query
    so hien tai — so moi nhat tu push ~1 giay/lan la gan nhat). Gui ve chat goi lenh."""
    area = _AREA
    enabled = _box_area_enabled()       # set(channel_id) co AreaRuleData, None neu loi
    by_name = {str(cid): name for cid, name in _box_channels()}

    def _val(cid):
        """(count, name) cho 1 camera: uu tien _AREA (moi nhat trong phien), roi lich su."""
        x = area.get(cid)
        if x and x.get('count') is not None:
            return x.get('count'), by_name.get(cid) or x.get('name') or ('CH' + cid)
        n, nm = _area_last(cid)          # so cuoi cung da tung nhan (du push dung)
        if n is not None:
            return n, by_name.get(cid) or nm or ('CH' + cid)
        return None, by_name.get(cid) or ('CH' + cid)

    a = args.strip().lower()
    lines = []
    # List camera ap dung: nhung cai co bat dem nguoi (hoac tat ca neu khong doc duoc)
    area_ids = sorted(enabled) if enabled is not None else sorted(area, key=lambda k: int(k))
    if a == 'sum':
        if not area_ids:
            _tg_post('sendMessage', chat, {'text': 'Không có camera nào bật đếm người trong vùng trên box.'})
            return True, None
        total = sum(_val(cid)[0] or 0 for cid in area_ids)
        lines.append(f'👥 Tổng người ở {len(area_ids)} camera (có bật đếm người): {total}')
    elif a == '':
        if not area_ids:
            _tg_post('sendMessage', chat, {'text': 'Không có camera nào bật đếm người trong vùng trên box.'})
            return True, None
        lines.append(f'👥 Số người ({len(area_ids)} camera có bật đếm người):')
        for cid in area_ids:
            n, name = _val(cid)
            lines.append(f'📹 {name} (CH{cid}): {n if n is not None else "chưa có dữ liệu đếm"} người')
    else:
        # loc tung ch1,ch2...
        want = [str(c).replace('ch', '').replace('CH', '').strip() for c in
                re.split(r'[,\s]+', a) if c]
        lines.append('👥 Số người theo camera:')
        for w in want:
            name = by_name.get(w)
            if name is None:
                lines.append(f'📹 CH{w}: không có camera này trên box')
                continue
            n, nm = _val(w)
            lines.append(f'📹 {nm} (CH{w}): {n if n is not None else "chưa có dữ liệu đếm"} người')
    _tg_post('sendMessage', chat, {'text': '\n'.join(lines)})
    return True, None


def _tg_setup(args, chat):
    """Cau hinh cho CHINH nhom go lenh. Chua /setup = nhom do khong nhan alarm nao,
    du da tick o tab Cau hinh tren web. Luu vao aibox.conf.json.
    /setup all platform<N> — chi nhan alarm tu platform N (slot box day ve)."""
    a = args.strip()
    setups = config.CONN.setdefault('tg_setup', {})
    cur = setups.get(str(chat)) or {}
    low = a.lower()
    # Lenh co the kem platform: '/setup all platform1' hoac '/setup platform2'
    # hoac '/setup c27 platform1'. Tach platform rieng khoi phan con lai.
    platform = None
    mplat = re.match(r'^(.*?)\s+platform\s*(\d+)\s*$', low)
    if mplat:
        platform = int(mplat.group(2))
        low = (mplat.group(1) or '').strip()
    if not low:
        if cur.get('mode') == 'all':
            st = 'gui TAT CA alarm' + (f' (platform {cur.get("platform")})' if cur.get('platform') else '')
        elif cur.get('mode') == 'rule':
            st = f"setup '{cur.get('name')}' — chua gui alarm nao"
        else:
            st = 'CHUA setup — khong nhan alarm nao'
        _tg_post('sendMessage', chat, {'text': (
            f'⚙️ Nhóm này: {st}\n\n'
            '/setup all — gửi tất cả alarm\n'
            '/setup all platform1 — chỉ nhận alarm từ platform 1\n'
            '/setup all platform2 — chỉ nhận alarm từ platform 2\n'
            '/setup off — tắt, không nhận gì\n'
            '/setup <tên> — tạo setup rỗng (vd /setup c27)\n'
            '/uniform — xem ai sai đồng phục hôm nay\n'
            '/late — xem ai đi muộn hôm nay\n'
            '/video <id> — gửi lại clip của alarm #id')})
        return True, None
    if low in ('off', 'tat', 'tắt'):
        setups.pop(str(chat), None)
        repos.ConfigRepo.save(config.CONN)
        _tg_post('sendMessage', chat, {'text': '🔕 Đã tắt — nhóm này không nhận alarm nào.'})
        return True, None
    if low == 'all':
        setups[str(chat)] = {'mode': 'all', 'name': 'all', 'algos': [], 'platform': platform}
        msg = ('🔔 Đã bật — nhóm này nhận TẤT CẢ alarm'
               + (f' từ platform {platform}.' if platform else '.'))
    else:
        setups[str(chat)] = {'mode': 'rule', 'name': a, 'algos': []}
        msg = (f"⚙️ Đã tạo setup '{a}' cho nhóm này.\n"
               'Hiện chưa gửi alarm nào.')
    repos.ConfigRepo.save(config.CONN)
    _tg_post('sendMessage', chat, {'text': msg})
    return True, None


def _tg_check(kind, chat):
    """/uniform va /late: liet ke nguoi da danh dau sai dong phuc / di muon hom nay.
    Doc state c27 (tg_person_today) cua NGAY HOM NAY — reset 00:00."""
    day = _c27_hm(time.time())[1]
    with _C27_LOCK:
        st = _c27_load(day)
        names = st.get(kind) or []
    if not names:
        label = 'sai đồng phục' if kind == 'uniform' else 'đi muộn'
        _tg_post('sendMessage', chat, {'text': f'⚪ Chưa ai {label} hôm nay.'})
        return True, None
    title = 'Sai đồng phục' if kind == 'uniform' else 'Đi muộn'
    _tg_post('sendMessage', chat, {'text': (
        f'👔 {title} hôm nay ({len(names)} người):\n' +
        '\n'.join(f'• {n}' for n in names))})
    return True, None


def _tg_send_video(args, chat):
    """Tra loi /video <id>: gui lai clip cua alarm do. Uu tien file box day ve (neu
    co), khong thi KEO lai tu video_url. Box chi giu clip mot khoang thoi gian nen
    het han thi bao thang, khong gui nham clip rong.
    Giữ _TG_CHAT_LOCK[chat] TRONG CA luc tai clip + gui video: cac alarm khac cung
    nhom phai doi (xem _tg_post) roi moi gui tiep — khong chen giua luc gui video."""
    with _tg_chat_lock(chat):
        aid = args.strip().lstrip('#')
        if not aid:
            _tg_post('sendMessage', chat, {'text':
                     'Dùng: /video <id> — id nằm ở dòng 🆔 của tin alarm.'})
            return True, None
        rec = next((r for r in _tg_log_tail() if str(r.get('id')) == aid), None)
        if not rec:
            _tg_post('sendMessage', chat, {'text': f'Không tìm thấy alarm #{aid}.'})
            return True, None
        f = _tg_video(rec.get('file') or '') or _tg_video_url(rec)
        if not f:
            print(f'[tg] /video #{aid}: box khong tra clip')
            _tg_post('sendMessage', chat, {'text': f'Clip của alarm #{aid} đã hết hạn trên box.'})
            return True, None
        print(f'[tg] /video #{aid}: gui clip {len(f[1])} bytes')
        _tg_post('sendVideo', chat, {'caption': rec.get('cap') or f'Alarm #{aid}'}, {'video': f})
        return True, None


def _tg_handle_command(text, chat):
    """Xu ly lenh tu Telegram: bat dau bang '/'. /countpeople, /setup, /video."""
    body = text.strip()
    if not body.startswith('/'):
        return False
    cmd, _, rest = body.partition(' ')
    cmd = cmd.lower()
    if cmd in ('/countpeople', '/count_people', '/count'):
        _tg_countpeople(rest, chat)
        return True
    if cmd == '/setup':
        _tg_setup(rest, chat)
        return True
    if cmd == '/uniform':
        _tg_check('uniform', chat)
        return True
    if cmd == '/late':
        _tg_check('late', chat)
        return True
    if cmd == '/video':
        _tg_send_video(rest, chat)
        return True
    return False


def _tg_collect(seen, upd):
    """Gop chat tu 1 update vao registry. Dung chung cho discover (khong confirm)
    va poll (co confirm) — de nhom moi them khong bi poll confirm lam mat."""
    chat = None
    for key in ('message', 'edited_message', 'channel_post', 'edited_channel_post'):
        if isinstance(upd.get(key), dict):
            chat = upd[key].get('chat'); break
    if not chat and isinstance(upd.get('callback_query'), dict):
        chat = (upd['callback_query'].get('message') or {}).get('chat')
    for key in ('my_chat_member', 'chat_member'):
        if not chat and isinstance(upd.get(key), dict):
            chat = upd[key].get('chat')
    if chat and chat.get('id') is not None:
        cid = str(chat['id'])
        seen[cid] = {'id': cid,
                     'title': chat.get('title') or chat.get('username')
                              or chat.get('first_name') or cid,
                     'type': chat.get('type', '')}


def _tg_poll():
    """Vong lap getUpdates lang nghe lenh tu nhom. Khi gap /countpeople thi tra loi
    ngay trong chat do. Dung offset de confirm update da xu ly -> khong lap lenh.
    Vua gop chat vao registry (dung chung _tg_collect) de nhom moi khong bi mat.
    Dung _TG_UPD_LOCK de khong 409 voi discover. That bai thi ngu 10s roi thu lai.
    Moi vong thanh cong nghi _TG_POLL_GAP giay — xem comment o _TG_POLL_GAP."""
    offset = 0
    while True:
        tok = config.CONN.get('tg_token')
        if not tok:
            time.sleep(3); continue
        try:
            with _TG_UPD_LOCK:                       # tranh 409 voi discover
                q = f'https://api.telegram.org/bot{tok}/getUpdates?timeout=8&offset={offset}'
                r = json.loads(urlopen(Request(q), timeout=15).read() or b'{}')
            if not r.get('ok'):
                time.sleep(10); continue
            seen = repos.TgGroupsRepo.load()
            changed = False
            for upd in r.get('result') or []:
                uid = upd.get('update_id', 0)
                if uid < offset:
                    continue
                offset = uid + 1                 # confirm update nay (khong lay lai)
                before = len(seen)
                _tg_collect(seen, upd)
                if len(seen) != before:
                    changed = True
                msg = upd.get('message') or {}
                chat = (msg.get('chat') or {}).get('id')
                if chat is not None:
                    _tg_handle_command(msg.get('text') or '', str(chat))
            if changed:
                repos.TgGroupsRepo.save(seen)
            time.sleep(_TG_POLL_GAP)     # khong nghi -> lan ke tiep chac chan 409
        except Exception as e:
            print('[tg] poll loi:', e)
            time.sleep(10)