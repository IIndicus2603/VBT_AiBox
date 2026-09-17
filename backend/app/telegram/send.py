"""Telegram: gui message/clip toi nhom da /setup.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _TG_CHAT_LOCK / _tg_chat_lock (aibox.py:809-813)
  - _tg_post / _tg_post_raw (aibox.py:1315-1373)
  - _tg_send_all (aibox.py:1403-1409)
  - _tg_targets (aibox.py:1376-1400)
Imports: config. Gui qua Telegram Bot API bang stdlib (multipart/form-data tu tay
xay dung, khong dung thu vien ben ngoai). Khoa RIENG tung nhom de khong chen giua
luc gui video. _tg_targets la MOT cho duy nhat dinh nghia luat "nhom nao duoc
gui" — _tg_forward (c27) va _tg_send_all deu goi day.
"""
import io
import json
import secrets
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import config

# Nghi giua 2 lan getUpdates (xem bot.py). Khai o day vi _tg_post_raw cung doc.
_TG_CHAT_LOCK = {}               # str(chat_id) -> threading.RLock


def _tg_chat_lock(chat):
    return _TG_CHAT_LOCK.setdefault(str(chat), threading.RLock())


def _tg_post(method, chat, fields=None, files=None, _retry=0):
    """Gui 1 message/clip toi 1 chat, KHOA theo chat. Khoa giu TAT CA tin gui toi cung
    mot nhom theo thu tu (alarm, /video, reply lenh) -> khong chen giua luc gui video.
    Nhom khac co lock rieng, khong bi chan. _retry nho de giu chan lai lan gui."""
    with _tg_chat_lock(chat):
        return _tg_post_raw(method, chat, fields, files, _retry)


def _tg_post_raw(method, chat, fields=None, files=None, _retry=0):
    """multipart/form-data -> Telegram Bot API, gui toi 1 chat. Stdlib only.
    Tra ve (ok: bool, err: str|None). _retry = so lan da thu lai sau khi bi 429."""
    tok = config.CONN.get('tg_token')
    if not tok or not chat:
        return False, 'Chua dien bot token + chat id'
    bnd = '----aibox' + secrets.token_hex(8)
    buf = io.BytesIO()
    fields = dict(fields or {})
    fields['chat_id'] = chat
    for k, v in fields.items():
        buf.write(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (fn, data, ctype) in (files or {}).items():
        buf.write((f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"; '
                   f'filename="{fn}"\r\nContent-Type: {ctype}\r\n\r\n').encode())
        buf.write(data)
        buf.write(b'\r\n')
    buf.write(f'--{bnd}--\r\n'.encode())
    req = Request(f'https://api.telegram.org/bot{tok}/{method}', data=buf.getvalue(),
                  headers={'Content-Type': f'multipart/form-data; boundary={bnd}'})
    try:
        resp = json.loads(urlopen(req, timeout=30).read() or b'{}')
        if resp.get('ok'):
            return True, None
        d = resp.get('description') or 'Telegram tra ve ok=false'
        print('[tg]', method, 'that bai:', d)
        return False, d
    except HTTPError as e:                       # Telegram tra HTTP 4xx/5xx (vd 400)
        # Body chua description chinh xac ("chat not found", "bot was blocked"...)
        # — khong in chung chung "HTTP Error 400: Bad Request" ma mat goc benh.
        body = {}
        try:
            body = json.loads(e.read().decode('utf-8', 'replace') or b'{}')
        except Exception:
            body = {}
        # 429 = gui qua tay (Telegram gioi han ~20 tin/nhom/phut, ma box day alarm
        # lien tuc). retry_after noi ro doi bao lau; KHONG doi thi anh/clip mat han
        # — /video lay duoc clip 5MB tu box xong van khong gui duoc vi ly do nay.
        # Chi thu lai 1 lan: alarm tran ngap ma doi mai thi treo het thread.
        if body.get('error_code') == 429 and _retry < 1:
            wait = min(int((body.get('parameters') or {}).get('retry_after') or 3), 30)
            print(f'[tg] {method} bi gioi han toc do -> doi {wait}s gui lai')
            time.sleep(wait)
            return _tg_post_raw(method, chat, fields, files, _retry + 1)
        d = body.get('description') or ''
        err = d or str(e)
        print('[tg]', method, 'that bai:', err)
        return False, err
    except Exception as e:                       # loi TG khong duoc lam chet bridge
        print('[tg]', method, 'that bai:', e)
        return False, str(e)


def _tg_targets(ev=None, rule_send=False):
    """Nhom DUOC gui alarm nay: phai /setup trong CHINH nhom do. 'all' = gui het;
    'rule' = che do c27, chi gui khi rule_send (ket qua _c27_decide, tinh 1 lan
    cho ca event vi no co side effect ghi lich su).
    MOT cho duy nhat dinh nghia luat nay — _tg_forward va _tg_send_all deu goi day.
    Nguon chân ly = tg_setup (ghi khi go /setup trong nhom), KHONG con phu thuoc
    tg_chats (tick tren web). Add bot vao nhom + /setup la du.
    setup co 'platform' -> nhom do chi nhan alarm TỪ platform (slot) do. ev None
    (vd _tg_send_all khong co ev) thi chi loc qua nhom mode 'all' khong kiem platform."""
    ev_pf = ev.get('platform') if ev is not None else None
    out = []
    for c, s in (config.CONN.get('tg_setup') or {}).items():
        s = s or {}
        m = s.get('mode')
        want = s.get('platform')
        if m == 'all':
            # gui het tru khi setup chi dinh platform ma alarm khong khop
            if want and ev_pf is not None and ev_pf != want:
                continue
            out.append(c)
        elif m == 'rule' and ev is not None and rule_send:
            if want and ev_pf is not None and ev_pf != want:
                continue
            out.append(c)
    return out


def _tg_send_all(method, fields=None, files=None, chats=None):
    """Gui 1 media/text den cac nhom da /setup. chats=None -> tu loc theo tg_setup
    (khong co ev nen chi nhom mode 'all' lot qua)."""
    if not config.CONN.get('tg_token'):
        return
    for c in (_tg_targets() if chats is None else chats):
        _tg_post(method, c, fields, files)