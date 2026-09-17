"""Telegram: che do /setup <ten> — cham cong theo thu vien nguoi 'Default List'.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - _C27_* constants + _C27_LOCK (aibox.py:1544-1556)
  - _c27_hm / _c27_load / _c27_save / _c27_person / _c27_decide / _c27_mark
    (aibox.py:1559-1675)
  - _tg_forward (aibox.py:1678-1712)
State cua NGAY (tg_person_today) + lich su xuat hien (tg_person_log) o mongo
(repos) thay vi file jsonl. Cuoi module gan publish.tg_forward = _tg_forward de
_publish spawn thread gui Telegram — tranh import vong va khong chay khi pytest
import module nay chi de test _c27_decide.
Imports: config; send (_tg_send_all, _tg_targets); caption (_tg_image, _tg_caption,
_tg_next_id, _tg_alarm_log); db.repos; threading.
"""
import threading
import time

from app import config
from app.db import repos
from app.telegram.caption import _tg_alarm_log, _tg_caption, _tg_image, _tg_next_id
from app.telegram.send import _tg_send_all, _tg_targets

# ---- che do /setup <ten>  (c27) -------------------------------------------------
# Cham cong theo thu vien nguoi 'Default List'. State cua NGAY luu o repos
# tg_person_today (doi ngay thi reset, moc 00:00 nguoi dung da chon). Lich su xuat
# hien ghi append-only vao repos tg_person_log: muon biet "lan 1 o camera nao, lan
# 2 o dau" thi loc theo person roi sap theo ts.
_C27_LOCK = threading.Lock()
_C27_LIB = 'Default List'
_C27_DEADLINE = 8 * 3600 + 30 * 60        # 08:30 — truoc gio nay khong tinh di muon
_C27_CLOSE = 17 * 3600 + 30 * 60          # 17:30 — sau gio nay gui ca alarm vo danh
# Cac alarm LUON gui trong che do c27 (bat ke co nhan dien duoc nguoi hay khong),
# tru truong hop co luat rieng (vd EnterArea/OffDuty doi ten). Nguoi dung yeu cau:
# Absence, Sleep On Duty, Using Mobile Phone, Intrusion, Enter Area.
_C27_ALWAYS = frozenset({
    'EnterArea', 'OffDutyDetectionAlarm',
    'SleepingDetectionAlarm', 'PlayMobilePhoneDetection', 'FieldDetectorObjectsInside',
})


def _c27_hm(ts):
    """(giay-trong-ngay, 'YYYY-MM-DD', epoch 08:30 cua ngay do) theo gio may."""
    t = time.localtime(ts or time.time())
    return (t.tm_hour * 3600 + t.tm_min * 60, time.strftime('%Y-%m-%d', t),
            time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 8, 30, 0, 0, 0, -1)))


def _c27_load(day):
    """State cua `day`. Repo mang ngay khac (hoac hong) -> state trang = reset."""
    return repos.TgPersonTodayRepo.load(day)


def _c27_save(st):
    """Ghi state cua 1 ngay. Ngay lay tu chinh st (repo dung lam key)."""
    repos.TgPersonTodayRepo.save(st['date'], st)


def _c27_person(ev):
    """Ten nguoi nhan dien duoc TRONG thu vien, hoac '' neu vo danh / khac thu vien."""
    p = ev.get('person') or {}
    name = str(p.get('name') or '').strip()
    lib = str(p.get('lib') or '').strip()
    return '' if (not name or (lib and lib != _C27_LIB)) else name


def _c27_decide(ev):
    """Quyet dinh cho che do /setup <ten>. Tra (title, co_gui, mark).
      title = chu de thay cho ten algo, None = giu nguyen
      mark  = ('late'|'uniform', ten) — CHI goi _c27_mark sau khi gui that, de mot
              alarm bi mat anh khong danh dau oan roi chan nguoi do ca ngay.
    Moi lan nhan dien duoc deu ghi lich su xuat hien + lan dau tien trong ngay, KE CA
    khi alarm nay khong duoc gui — nguoi do van da co mat, xet di muon phai biet."""
    algo = ev.get('algo_model') or ''
    ts = int(ev.get('ts') or time.time())
    sec, day, deadline = _c27_hm(ts)
    person = _c27_person(ev)
    with _C27_LOCK:
        st = _c27_load(day)
        changed = False
        if person:
            repos.TgPersonLogRepo.append(
                {'ts': ts, 'day': day, 'person': person,
                 'cam': ev.get('channel_name') or '', 'algo': algo,
                 'sim': (ev.get('person') or {}).get('similarity')})
            if person not in st['first']:
                st['first'][person] = {'ts': ts, 'cam': ev.get('channel_name') or '',
                                       'algo': algo}
                changed = True
        # EnterArea va Absence(OffDutyDetectionAlarm): LUON gui + doi ten. Hai loai
        # nay khong bao gio kem nhan dien nguoi (0/322 ban ghi OffDuty co
        # compare_results) nen khong the theo luat "chi gui khi biet la ai".
        if algo == 'EnterArea':
            title, send, mark = 'Xâm phạm khu vực', True, None
        elif algo == 'OffDutyDetectionAlarm':
            title, send, mark = '1 người đã ra khỏi phòng 15 phút trước', True, None
        elif algo == 'LineDetectorCrossed':
            if sec < _C27_DEADLINE:
                # 00:00-08:30: im lang (van ghi lan xuat hien dau de xet di muon)
                title, send, mark = None, False, None
            elif sec >= _C27_CLOSE:
                title, send, mark = None, True, None      # sau 17:30: gui binh thuong
            else:
                # 08:30-17:30: KHONG gui tin "vuot vach". Chi bao di muon khi lan
                # xuat hien DAU TIEN trong ngay la SAU 08:30, 1 lan/nguoi/ngay.
                first = st['first'].get(person) if person else None
                late = bool(person) and person not in st['late'] \
                    and bool(first) and first['ts'] >= deadline
                if late:
                    title, send, mark = f'{person} đã đi muộn', True, ('late', person)
                else:
                    title, send, mark = None, False, None
        elif algo == 'WorkClothesAlarm':
            # Chi bao khi biet la ai, va 1 lan/nguoi/ngay.
            if person and person not in st['uniform']:
                title, send, mark = 'Sai đồng phục', True, ('uniform', person)
            else:
                title, send, mark = 'Sai đồng phục', False, None
        else:
            # Con lai: truoc 17:30 chi gui khi nhan dien duoc nguoi; sau 17:30 gui het.
            # Nhung cac alarm trong _C27_ALWAYS (Sleep, Mobile Phone, Intrusion...) LUON
            # gui, bat ke nhan dien duoc ai khong — nguoi dung yeu cau gui het loai nay.
            if algo in _C27_ALWAYS:
                title, send, mark = None, True, None
            else:
                title, send, mark = None, (bool(person) or sec >= _C27_CLOSE), None
        if changed:
            _c27_save(st)
    return title, send, mark


def _c27_mark(ev, mark):
    """Danh dau da gui 'late'/'uniform' cho nguoi nay. Lay ngay theo ts CUA ALARM
    (giong _c27_decide) de alarm luc 23:59:59 khong bi danh dau sang ngay hom sau."""
    kind, person = mark
    with _C27_LOCK:
        st = _c27_load(_c27_hm(ev.get('ts'))[1])
        if person not in st[kind]:
            st[kind].append(person)
            _c27_save(st)


def _tg_forward(ev):
    """Chay trong thread rieng. Alarm -> caption + ANH + id, gui toi nhom da /setup.
    KHONG tu gui clip nua: nguoi dung go /video <id> khi can (xem _tg_send_video)."""
    try:
        if ev.get('kind') != 'alarm':
            return                       # clip box day ve: khong tu gui
        # Loc truoc: keepalive (type 6) va dem nguoi (AreaRuleData) khong can gui Telegram
        if ev.get('type') == 6 or ev.get('algo_model') == 'AreaRuleData':
            return
        chats = list((config.CONN.get('tg_setup') or {}).keys())
        setups = config.CONN.get('tg_setup') or {}
        # Che do /setup <ten>: _c27_decide co side effect (ghi lich su xuat hien)
        # nen goi DUNG 1 LAN cho ca event, khong goi theo tung nhom.
        if any((setups.get(str(c)) or {}).get('mode') == 'rule' for c in chats):
            title, send, mark = _c27_decide(ev)
        else:
            title, send, mark = None, True, None
        chats = _tg_targets(ev, send)
        if not chats:
            return                       # chua /setup, hoac c27 chan -> im lang
        img = _tg_image(ev)
        if not img:
            # Khong co anh -> IM. Gui text khong anh chi lam loang nhom (alarm loi,
            # box chua kip luu anh). Caption con o log.
            print(f'[tg] bo qua (khong co anh): {ev.get("algo_model")}')
            return
        aid = _tg_next_id()
        cap = _tg_caption(ev, aid, title)
        _tg_alarm_log(aid, ev, cap)
        if mark:
            _c27_mark(ev, mark)          # danh dau SAU khi chac chan co cai de gui
        print(f'[tg] gui anh #{aid} cho {ev.get("algo_model")} ({len(img[1])} bytes)')
        _tg_send_all('sendPhoto', {'caption': cap}, {'photo': img}, chats)
    except Exception as e:
        print('[tg] forward that bai:', e)


# ---- gan hook publish.tg_forward de _publish spawn thread gui Telegram ----------
# Lam o CUOI module. Gan module-attr khong goi gi — nhung chi chay khi import that
# (khong phai duoi pytest, noi chi test _c27_decide bang repo fake) de khong lam
# ron luoi import trong test.
if 'pytest' not in __import__('sys').modules:
    from app.alarm import publish as _pub
    _pub.tg_forward = _tg_forward