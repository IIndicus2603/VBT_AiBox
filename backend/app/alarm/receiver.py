"""Alarm ingress: receive box pushes, gate reconnects, normalize, persist, publish.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _AREA (aibox.py:836) + box-recon state (_BOX_* lines 852-860)
  - _box_recon_arm / _box_recon_drain (aibox.py:863-882)
  - _box_gate (aibox.py:885-910)
  - handle_alarm / _process_alarm (aibox.py:1813-1874)
  - _area_last (aibox.py:913-956; JSONL scan -> AlarmRepo.area_last)
  - _box_channels / _box_area_enabled (aibox.py:993-1027)
Imports: config; normalize (_norm_alarm, _save_images); publish (_publish);
box.client (box); db.repos. _process_alarm appends to repos (mongo) instead of
jsonl; _AREA stays in RAM. Does NOT redefine _norm_alarm/_publish.
"""
import json
import os
import secrets
import threading
import time
from email.parser import BytesParser

from app import config
from app.alarm.normalize import _norm_alarm, _save_images
from app.alarm.publish import _publish, _video_buf
from app.box.client import box
from app.db import repos

# So nguoi trong vung moi nhat theo camera: {channel_id: {'count': n, 'name': ten, 'ts': time}}.
# Cap nhat moi khi box day AreaRuleData (dem nguoi real-time, ~1 dong/giay). Bot dung
# de tra loi /countpeople.
_AREA = {}

# ---- chong "lay lai hang cu" sau khi BE mat ket noi voi box ------------------
# Khi link box<->BE dut, box TAM GIU alarm trong bo nho roi khi noi lai day lai CA
# HANG CU trong vai giay (bang chung: 09-14 08:25:12 co ~84 alarm capture_time
# 08:18-08:20 day trong 4s). BE chi nen nhan alarm moi nhat, bo hang cu.
# Kho dung tre (capture_time) de phan biet: box KHONG dong ho voi PC (tre 300-1500s,
# troi) nen tre cua alarm thuong truong hop da lon hon ca phan thua cua hang cu.
# Cach phan biet thuc su: hang cu day BAT LOAN (nhieu alarm trong vai giay), con
# alarm thuong dan trai. Vay: khi phat hien im lang > _BOX_GAP (mat ket noi), mo cua
# so recon _BOX_RECON giay — trong do buffer moi alarm, chi GIU alarm co capture_time
# moi nhat, bo phan con lai khi het cua so.
# ponytail: truong hop BE moi khoi dong DUNG LUC box dang xa hang cu (BE down lau roi
# moi len) se khong bat duoc — alarm dau tien xem nhu cold-start nen nhan het hang.
# It gap (bang chung: downtime dai khong replay). Them 1 flag "dang xa hang cu" khi
# doc thay jsonl duoc ghi truoc do co luong lon se bat duoc neu can.
_BOX_LOCK = threading.Lock()
_BOX_GAP = 90            # giay im lang -> coi la vua mat ket noi
_BOX_RECON = 20          # cua so "noi lai": chi giu alarm moi nhat trong khoang nay
_BOX_AT = 0.0            # lan cuoi nhan duoc alarm (dong ho PC)
_BOX_RECON_UNTIL = 0.0   # den bao gio het cua so recon
_BOX_BUF = []            # cac alarm (ct, alarm, stamp) trong cua so recon
_BOX_BEST = None         # (ct, alarm, stamp) moi nhat trong BUF
_BOX_TIMER = None        # timer het cua so recon
_BOX_DROP = 0            # dem alarm da bo


def _box_recon_arm():
    """Khoi dong timer het cua so recon -> xu ly alarm moi nhat, bo phan con lai."""
    global _BOX_TIMER
    if _BOX_TIMER:
        _BOX_TIMER.cancel()
    _BOX_TIMER = threading.Timer(_BOX_RECON + 0.5, _box_recon_drain)
    _BOX_TIMER.daemon = True
    _BOX_TIMER.start()


def _box_recon_drain():
    """Het cua so recon: xu ly alarm moi nhat da buffer, bo phan con lai."""
    global _BOX_BUF, _BOX_BEST, _BOX_TIMER, _BOX_DROP
    with _BOX_LOCK:
        best, drop_n = _BOX_BEST, (len(_BOX_BUF) - 1 if _BOX_BEST else 0)
        _BOX_BUF, _BOX_BEST, _BOX_TIMER = [], None, None
    if best:
        _BOX_DROP += drop_n
        print(f'[box] noi lai, bo {drop_n} alarm cu, giu alarm {best[0]}')
        _process_alarm(best[1], best[2])


def _box_gate(alarm, stamp):
    """Tra True = xu ly alarm nay ngay. False = dang trong cua so recon (mat ket noi
    roi noi lai) -> buffer lai, chi alarm moi nhat duoc xu ly khi het cua so."""
    global _BOX_AT, _BOX_RECON_UNTIL, _BOX_BUF, _BOX_BEST
    now = time.time()
    with _BOX_LOCK:
        gap = now - _BOX_AT
        _BOX_AT = now
        if _BOX_RECON_UNTIL == 0 and gap > _BOX_GAP:
            # Lan dau BE khoi dong (_BOX_RECON_UNTIL==0), gap lon la do moi chay chu
            # khong phai mat ket noi -> khong mo recon, chap nhan alarm dau tien.
            _BOX_RECON_UNTIL = now - _BOX_RECON   # da "dung truoc" tu lau
        elif gap > _BOX_GAP:
            # Vua mat ket noi roi noi lai -> mo cua so recon.
            _BOX_RECON_UNTIL = now + _BOX_RECON
            _BOX_BUF, _BOX_BEST = [], None
            _box_recon_arm()
        if now < _BOX_RECON_UNTIL:
            # Dang trong cua so recon: buffer, chi giu alarm co capture_time moi nhat.
            ct = (alarm.get('behaviour') or alarm.get('face') or {}).get('capture_time')
            ct = ct if isinstance(ct, (int, float)) else 0
            _BOX_BUF.append((ct, alarm, stamp))
            if _BOX_BEST is None or ct > _BOX_BEST[0]:
                _BOX_BEST = (ct, alarm, stamp)
            return False
    return True


def handle_alarm(body, ctype, platform=None):
    os.makedirs(config.ALARM_DIR, exist_ok=True)
    stamp = time.strftime('%Y%m%d_%H%M%S') + f'_{secrets.token_hex(3)}'

    if 'multipart' in (ctype or ''):                # 13.2 video / 13.3 PDF
        msg = BytesParser().parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        uuid, blob, name = None, None, 'upload.bin'
        for part in msg.walk():
            if part.get_content_maintype() == 'multipart':
                continue
            disp = part.get_param('name', header='content-disposition')
            payload = part.get_payload(decode=True) or b''
            if disp == 'video_uuid':
                uuid = payload.decode(errors='replace').strip()
            elif payload:
                blob, name = payload, part.get_filename() or name
        if blob:
            fn = os.path.join(config.ALARM_DIR, f'{uuid or stamp}_{name}')
            with open(fn, 'wb') as f:
                f.write(blob)
            # Khong co bao dam thu tu: video co the den truoc alarm JSON.
            _video_buf[uuid] = os.path.basename(fn)
            _publish({'kind': 'video', 'video_uuid': uuid, 'file': os.path.basename(fn)})
        return

    alarm = json.loads(body or b'{}')
    t = alarm.get('type')
    # Box KHONG gui field platform trong payload — no gui alarm den URL rieng
    # (?slot=1 / ?slot=2) da dang ky. Ghi platform (slot) vao alarm ngay day de no
    # di xuyen _box_gate/recon va _norm_alarm, cho Telegram loc theo /setup platformN.
    if platform is not None:
        alarm['platform'] = platform
    # Box thinh thoang POST body rong/{} nhu heartbeat keep-alive loi (kep giua hai
    # type 6 trong jsonl). Khong phai phat hien: bo qua, khong ghi jsonl khong publish.
    if t is None:
        return
    # Chong "lay lai hang cu": vua mat ket noi voi box roi noi lai, box day lai alarm
    # cu -> chi giu alarm moi nhat, bo hang cu. Bo truoc khi luu anh/jsonl/publish.
    if not _box_gate(alarm, stamp):
        return                                  # dang xa hang cu, xu ly sau (drain)
    _process_alarm(alarm, stamp)


def _process_alarm(alarm, stamp):
    """Xu ly 1 alarm: luu anh -> chuan hoa -> ghi mongo -> publish (SSE + Telegram).
    Tach ra de vua goi truc tiep (alarm thuong) vua goi tu timer het cua so recon
    (chi alarm moi nhat cua hang cu duoc xu ly)."""
    saved, person_img = _save_images(alarm, stamp)
    ev = _norm_alarm(alarm, images=saved, person_image=person_img)
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    # AreaRuleData = dem nguoi trong vung (real-time) -> cap nhat so moi nhat cho /countpeople.
    if obj.get('algo_model') == 'AreaRuleData' and ev.get('channel_id') is not None:
        _AREA[str(ev['channel_id'])] = {'count': ev.get('area_num'),
                                        'name': ev.get('channel_name') or ('CH' + str(ev['channel_id'])),
                                        'ts': int(time.time())}
    uuid = obj.get('video_uuid')
    if uuid:
        ev['video_uuid'] = uuid
        ev['video'] = _video_buf.pop(uuid, None)
    repos.AlarmRepo.append(alarm)
    _publish(ev)


def _area_last(channel_id):
    """So dem nguoi CUOI CUNG da tung nhan cho 1 camera (du push da dung). _AREA chi
    giu trong RAM (mat khi restart); khi camera khong co trong _AREA (chua push trong
    phien nay / may moi khoi dong), quet repo alarm moi nhat tim AreaRuleData cuoi cho
    channel do. Tra (count, name) hoac (None, None) neu chua bao gio co.
    (Ported from aibox.py:913-956; JSONL scan replaced by AlarmRepo.area_last.)"""
    return repos.AlarmRepo.area_last(channel_id)


def _box_channels():
    """Danh sach CAMERA co tren box qua /channel/list. Tra [(channel_id, channel_name)].
    Khi khong doc duoc (chua co IP/pass/box loi) -> [] de bot chi in camera co du lieu."""
    if not config.CONN['host'] or not config.CONN['pass']:
        return []
    try:
        r = box.call('/api/v2/channel/list', {'page': 1, 'pagesize': 100})
        if r.get('code') != 0:
            return []
        chans = r.get('data', {}).get('channel_list') or r.get('data', {}).get('list') or []
        return [(c.get('channel_id'), c.get('channel_name') or ('CH' + str(c.get('channel_id'))))
                for c in chans if c.get('channel_id') is not None]
    except Exception:
        return []


def _box_area_enabled():
    """HOI box truc tiep: camera nao dang bat thuật toán dem nguoi trong vung
    (AreaRuleData). GET /api/v2/smart/enable/list -> [{channel_id, algo_model:[...]}].
    Tra set(channel_id) co AreaRuleData. Khong doc duoc -> tra None (bot se khong
    loc, hien tat ca camera co du lieu)."""
    if not config.CONN['host'] or not config.CONN['pass']:
        return None
    try:
        r = box.call('/api/v2/smart/enable/list', {})
        if r.get('code') != 0:
            return None
        out = set()
        for c in r.get('data') or []:
            algos = c.get('algo_model') or []
            if any(str(a) == 'AreaRuleData' for a in algos):
                out.add(str(c.get('channel_id')))
        return out or None          # None khi khong co camera nao bat dem
    except Exception:
        return None