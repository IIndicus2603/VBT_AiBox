"""SSE fan-out: push normalized alarms to subscribed EventSource clients.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _subs, _subs_lock, _video_buf (aibox.py:691-692)
  - _publish (aibox.py:764-785)
Imports: config. _publish spawns the Telegram forward in a daemon thread via the
module-level `tg_forward` hook (set later by app.alarm.telegram) so this module
does not import telegram at import time — avoiding the circular import. Does NOT
define _norm_alarm/_box_gate (normalize.py / receiver.py).
"""
import json
import queue
import threading

from app import config

# -------------------------------------------------------------- alarm receiver
_subs, _subs_lock = [], threading.Lock()
_video_buf = {}

# Telegram forward callback, spawned by _publish in a daemon thread. Set by the
# telegram module at startup (import app.alarm.telegram wires this). Lazy hook
# keeps the import graph normalize -> publish -> receiver acyclic.
tg_forward = None


def _publish(ev):
    line = f'data: {json.dumps(ev, ensure_ascii=False)}\n\n'.encode()
    with _subs_lock:
        for q in _subs:
            # Queue day = client doc cham hon box day (AreaRuleData ~1 dong/giay,
            # 200 slot chi vai phut la tran). TRUOC DAY huy dang ky luon: vong _sse
            # van chay va van gui ': ping' moi 20s nen EventSource khong he biet la
            # bi ngat -> khong reconnect -> tab Nhat ky DUNG YEN VINH VIEN va tuong
            # nhu "cham hon aibox". Vut tin CU, giu dang ky: thieu vai AreaRuleData
            # khong sao (badge chi can so cuoi cung), mat ket noi moi la chet.
            while q.full():
                try:
                    q.get_nowait()
                except queue.Empty:
                    break
            try:
                q.put_nowait(line)
            except queue.Full:
                pass
    # Day ra ngoai (Telegram...) KHONG duoc chan HTTP handler cua box -> thread rieng.
    if config.CONN.get('tg_token') and config.CONN.get('tg_setup'):
        fn = tg_forward or _default_forward
        threading.Thread(target=fn, args=(ev,), daemon=True).start()


def _default_forward(ev):
    """No-op fallback until the telegram module wires publish.tg_forward."""
    return None