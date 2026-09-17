"""Telegram: caption + anh/video cua alarm.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _tg_caption (aibox.py:1412-1443)
  - _tg_image (aibox.py:1446-1462)
  - _tg_video (aibox.py:1465-1470)
  - _tg_video_url (aibox.py:1473-1493)
  - _tg_log_tail (aibox.py:1496-1515)
  - _tg_next_id (aibox.py:1518-1524)
  - _tg_alarm_log (aibox.py:1527-1536)
Imports: config; repos. File I/O (ALARM_DIR) cho _tg_image/_tg_video; nhat ky alarm
(giup /video <id> keo lai clip) ghi vao repos.tg_alarm_log thay vi file jsonl.
Dich ten hanh vi qua _algo_vi (normalize); tai anh/clip tu box qua box.raw.
"""
import json
import os
import time

from app import config
from app.alarm.normalize import _algo_vi
from app.box.client import box
from app.db import repos


def _tg_caption(ev, aid=None, title=None):
    ts = ev.get('ts')
    when = time.strftime('%H:%M:%S %d/%m/%Y', time.localtime(ts)) if ts else ''
    # Dong dau: 🚨 + ten hanh vi tieng Viet (dich tu algo_model). Ghi ro "behavior".
    # title = chu de do che do c27 dat lai ('Sai đồng phục', '<ten> đã đi muộn'...).
    parts = [f"\U0001f6a8 {title or _algo_vi(ev)}"]
    # Chi tiet doi tuong phat hien: capture_info moi phan tu = 1 doi tuong. Alarm
    # nhan dien mat (type 4/5) KHONG co capture_info -> dem theo compare_results.
    person = ev.get('person') or {}
    n_obj = len(ev.get('capture_info') or []) or (1 if person else 0)
    if n_obj:
        who = str(person.get('name') or '').strip()
        sim = person.get('similarity')
        if who and sim is not None:
            who = f'{who} {sim}%'
        # Khong co ten -> noi ro "khong nhan dien duoc", dung de trong gay hieu nham.
        parts.append(f"\U0001f465 {n_obj} doi tuong phat hien - "
                     f"{who or 'khong nhan dien duoc'}")
    if ev.get('channel_name'):
        parts.append(f"\U0001f4f7 Camera {ev['channel_name']}")
    if ev.get('ipc_addr'):
        parts.append(f"IP {ev['ipc_addr']}")
    if ev.get('area_num'):
        parts.append(f"\U0001f465 {ev['area_num']} nguoi trong vung")
    if when:
        parts.append(f"\U0001f552 {when}")
    if aid is not None:
        # /video <id> de gui lai clip. Kem platform (slot) nguon de nhan biet may
        # nao dang gui — giua 2 platform cung 1 bot token.
        pf = f' · platform {ev["platform"]}' if ev.get('platform') is not None else ''
        parts.append(f"\U0001f194 #{aid}{pf}")
    return '\n'.join(parts)


def _tg_image(ev):
    """Anh dau tien cua alarm -> (ten, bytes, ctype). base64 da luu dia, hoac URL
    /aibox/picture? (anh nam tren box) -> GET nguoc bang digest."""
    for im in ev.get('images') or []:
        try:
            if im.startswith('/aibox/picture'):
                st, data = box.raw('GET', '/api/v2/smart/picture?' + im.split('?', 1)[-1])
                if st == 200 and data:
                    return ('alarm.jpg', data, 'image/jpeg')
            else:
                p = os.path.join(config.ALARM_DIR, im)
                if os.path.isfile(p):
                    with open(p, 'rb') as f:
                        return (im, f.read(), 'image/jpeg')
        except Exception as e:
            print('[tg] anh that bai:', e)
    return None


def _tg_video(fn):
    p = os.path.join(config.ALARM_DIR, fn)
    if os.path.isfile(p):
        with open(p, 'rb') as f:
            return (fn, f.read(), 'video/mp4')
    return None


def _tg_video_url(ev):
    """Kéo clip từ box qua video_url (dang /aibox/video?ChlId=..&StartTime=..&EndTime=..).
    Box KHONG push file video — chi cung cap video_url de KEO ve (clip cat theo khoang
    thoi gian, ~1.4MB). Dung digest auth nhu _tg_image. Tra (ten, bytes, ctype) hoac None."""
    u = ev.get('video_url') or ev.get('url')   # log alarm ghi key 'url'
    if not u:
        return None
    q = u.split('?', 1)[-1] if '?' in u else ''
    if not q:
        return None
    try:
        st, data = box.raw('GET', '/api/v2/smart/video?' + q)
        # Clip < 1KB la rong (box khong con giu video cho khoang thoi gian cu) —
        # gui len Telegram chi ra video den/loi. Coi nhu khong co video, de loi
        # cho anh phat hien.
        if st == 200 and data and len(data) >= 1024:
            return ('alarm.mp4', data, 'video/mp4')
        print('[tg] video_url tra', st, len(data or b''), 'bytes')
    except Exception as e:
        print('[tg] video that bai:', e)
    return None


def _tg_log_tail(n=500):
    """Nhat ky alarm da gui (repos.TgAlarmLogRepo), moi nhat truoc. Chi doc duoi: id
    can tim va clip cua no luon nam trong nhom alarm moi nhat (alarm cu thi box cung
    het giu clip). Lay tu repo (mongo sort giam dan theo id) thay vi file jsonl."""
    return repos.TgAlarmLogRepo.tail(n)


def _tg_next_id():
    """So thu tu alarm, tang dan. Lay tu repo: max id trong nhat ky + 1 (khong gio
    seq trong RAM de khong lech voi nhung thiet bi/thread khac cung gui)."""
    return repos.TgAlarmLogRepo.next_id()


def _tg_alarm_log(aid, ev, cap):
    """Ghi nguon clip cua alarm de /video <id> keo lai duoc. Append-only, khong lock."""
    repos.TgAlarmLogRepo.append(aid, ev, cap)