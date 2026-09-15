"""Smoke test cho phan Telegram: gate /setup theo nhom, caption ten/%/id, /video."""
import types, sys, os, io, json, time, tempfile
os.chdir(os.path.dirname(__file__) or '.')

# Stub out heavy deps so aibox.py can be imported without starting a server
for mod in ('go2rtc',):
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

import aibox as ab

# KHONG duoc cham vao aibox.conf.json that: /setup goi save_conf().
ab.save_conf = lambda: None
ab._TG_ALARM_LOG = os.path.join(tempfile.mkdtemp(), 'tg_alarms.jsonl')

calls = []
_real_tg_post = ab._tg_post          # ham that, dung lai o buoc 12 (test 429)
ab._tg_send_all = lambda m, f, files=None, chats=None: calls.append((m, f, chats or []))
ab._tg_post = lambda m, chat, f=None, files=None: calls.append((m, f))
ab._tg_image = lambda ev: ('a.jpg', b'x', 'image/jpeg')

GROUP = '-1004388253380'
ab.CONN['tg_token'] = 'test-token'
ab.CONN['tg_chats'] = [GROUP]
ab.CONN['tg_setup'] = {}


ab._C27_TODAY = os.path.join(tempfile.mkdtemp(), 'today.json')
ab._C27_LOG = os.path.join(tempfile.mkdtemp(), 'hist.jsonl')


def at(h, m=0, day=16):
    """Epoch cua hh:mm ngay 2026-09-<day> theo gio may — test dung gio that."""
    return time.mktime((2026, 9, day, h, m, 0, 0, 0, -1))


def alarm(**kw):
    ev = {'kind': 'alarm', 'type': 1, 'algo_model': 'OffDutyDetectionAlarm', 'ts': 1}
    ev.update(kw)
    return ev


# 1) Chua /setup -> KHONG gui gi, du nhom da tick o tab Cau hinh
calls.clear()
ab._tg_forward(alarm())
assert not calls, f'chua /setup ma da gui: {calls}'

# 2) /setup all trong nhom -> gui
ab._tg_setup('all', GROUP)
assert ab.CONN['tg_setup'][GROUP]['mode'] == 'all', ab.CONN['tg_setup']
calls.clear()
ab._tg_forward(alarm())
assert calls and calls[0][0] == 'sendPhoto' and calls[0][2] == [GROUP], calls

# 3) Nhom khac chua /setup -> khong dinh
ab.CONN['tg_chats'] = [GROUP, '-999']
calls.clear()
ab._tg_forward(alarm())
assert calls[0][2] == [GROUP], f'nhom chua setup cung nhan: {calls}'

# 4) /setup <ten> -> bat che do c27: alarm vo danh truoc 17:30 BI CHAN
ab.CONN['tg_chats'] = [GROUP]
ab._tg_setup('c27', GROUP)
assert ab.CONN['tg_setup'][GROUP]['mode'] == 'rule', ab.CONN['tg_setup'][GROUP]
calls.clear()
ab._tg_forward(alarm(algo_model='FieldDetectorObjectsInside', ts=at(10)))
assert not calls, f'c27 phai chan alarm vo danh: {calls}'
# nhung EnterArea thi LUON gui, doi ten thanh "Xâm phạm khu vực"
calls.clear()
ab._tg_forward(alarm(algo_model='EnterArea', ts=at(10)))
assert calls and 'Xâm phạm khu vực' in calls[0][1]['caption'], calls

# 5) /setup all roi /setup off -> tat han
ab._tg_setup('all', GROUP)
calls.clear()
ab._tg_forward(alarm())
assert calls, 'setup all phai gui'
ab._tg_setup('off', GROUP)
assert GROUP not in ab.CONN['tg_setup'], ab.CONN['tg_setup']
calls.clear()
ab._tg_forward(alarm())
assert not calls, f'da off ma van gui: {calls}'

# 6) Caption: ten + % ; khong nhan dien duoc ; dong id
cap = ab._tg_caption({'algo_model': 'ObjectIsRecognized', 'ts': 0,
                      'person': {'name': 'CHU MINH QUANG', 'similarity': 96},
                      'capture_info': [{}]}, 7)
assert '👥 1 doi tuong phat hien - CHU MINH QUANG 96%' in cap, cap
assert '🆔 #7' in cap, cap
cap = ab._tg_caption({'algo_model': 'OffDutyDetectionAlarm', 'ts': 0,
                      'capture_info': [{}]}, 8)
assert '👥 1 doi tuong phat hien - khong nhan dien duoc' in cap, cap
# alarm nhan dien mat (type 4/5) KHONG co capture_info van phai dem duoc 1 doi tuong
cap = ab._tg_caption({'algo_model': 'ObjectIsRecognized', 'ts': 0,
                      'person': {'name': 'A', 'similarity': 90}}, 9)
assert '1 doi tuong phat hien - A 90%' in cap, cap
# khong co ai -> khong co dong 👥
cap = ab._tg_caption({'algo_model': 'Fogging', 'ts': 0}, 10)
assert 'doi tuong phat hien' not in cap, cap

# 7) Clip box day ve KHONG tu gui nua (phai go /video)
ab._tg_setup('all', GROUP)
calls.clear()
ab._tg_forward({'kind': 'video', 'video_uuid': 'u', 'file': 'x.mp4'})
assert not calls, f'clip van tu gui: {calls}'

# 8) keepalive + dem nguoi van bi loc
for ev in (alarm(type=6), alarm(algo_model='AreaRuleData')):
    calls.clear()
    ab._tg_forward(ev)
    assert not calls, f'khong duoc gui: {ev}'

# 9) /video <id>: alarm duoc ghi log roi tra nguoc theo id. Dung ham _tg_video_url
# THAT, chi thay box bang fake de khong goi ra thiet bi.
class _FakeBox:
    def raw(self, method, path):
        assert path.startswith('/api/v2/smart/video?'), path
        return 200, b'x' * 2048


ab.box = _FakeBox()
ab._TG_SEQ = 0
calls.clear()
ab._tg_forward(alarm(video_url='/aibox/video?ChlId=5&StartTime=1&EndTime=2'))
assert calls and calls[0][0] == 'sendPhoto', calls
aid = ab._TG_SEQ
assert aid >= 1 and os.path.exists(ab._TG_ALARM_LOG), 'khong ghi tg_alarms.jsonl'
ab._tg_video = lambda fn: ('x.mp4', b'v', 'video/mp4') if fn else None   # box day file
calls.clear()
ab._tg_send_video(str(aid), GROUP)
assert calls and calls[0][0] == 'sendVideo', f'/video khong gui clip: {calls}'
calls.clear()
ab._tg_send_video('#99999', GROUP)
assert calls and calls[0][0] == 'sendMessage', f'/video id sai khong bao: {calls}'
# alarm #1 (o buoc 2) khong co video_url -> phai bao het han, khong gui clip rong
calls.clear()
ab._tg_send_video('1', GROUP)
assert calls and calls[0][0] == 'sendMessage' and 'hết hạn' in calls[0][1]['text'], calls

# 11) /video phai keo duoc clip bang CHINH ham that _tg_video_url tren record do
# _tg_alarm_log ghi ra. Truoc day log ghi key 'url' con _tg_video_url doc
# 'video_url' -> luon None -> /video bao "het han" du box co clip.
ab._TG_ALARM_LOG = os.path.join(tempfile.mkdtemp(), 'tg_alarms.jsonl')
ab._tg_video = lambda fn: None                    # khong co file box day ve
ab._tg_alarm_log(1, {'ts': 1,
                     'video_url': '/aibox/video?ChlId=6&StartTime=1&EndTime=2'}, 'cap')
recs = [json.loads(l) for l in open(ab._TG_ALARM_LOG, encoding='utf-8')]
assert recs[0].get('url') or recs[0].get('video_url'), f'thieu url clip: {recs[0]}'
f = ab._tg_video_url(recs[0])
assert f and len(f[1]) == 2048, f'khong keo duoc clip tu record: {f}'
calls.clear()
ab._tg_send_video('1', GROUP)
assert calls and calls[0][0] == 'sendVideo', f'/video khong keo clip tu url: {calls}'

# 10) dinh tuyen lenh
for text, want in (('/setup', '_tg_setup'), ('/setup all', '_tg_setup'),
                   ('/video 3', '_tg_send_video'), ('/countpeople', '_tg_countpeople')):
    seen = []
    keep = {k: getattr(ab, k) for k in ('_tg_setup', '_tg_send_video', '_tg_countpeople')}
    for k in keep:
        setattr(ab, k, (lambda n: lambda *a, **kw: seen.append(n))(k))
    ab._tg_handle_command(text, GROUP)
    for k, v in keep.items():
        setattr(ab, k, v)
    assert seen == [want], f'{text} -> {seen}, doi {want}'
assert ab._tg_handle_command('hello', GROUP) is False, 'text thuong khong phai lenh'

# 12) 429 Too Many Requests -> doi retry_after roi GUI LAI, khong duoc bo tin nhan.
# Day la ly do /video lay duoc clip 5MB tu box ma van khong gui duoc.
from urllib.error import HTTPError as _HE

_hits, _slept = [], []


def _fake_urlopen(req, timeout=None):
    _hits.append(req.full_url)
    if len(_hits) == 1:
        body = json.dumps({'ok': False, 'error_code': 429,
                           'description': 'Too Many Requests: retry after 2',
                           'parameters': {'retry_after': 2}}).encode()
        raise _HE(req.full_url, 429, 'Too Many Requests', {}, io.BytesIO(body))
    return type('R', (), {'read': staticmethod(lambda: b'{"ok":true}')})()


_keep = ab.urlopen, time.sleep
ab.urlopen, time.sleep = _fake_urlopen, _slept.append
try:
    ab._tg_post = _real_tg_post      # retry goi lai chinh no qua global
    ok, err = _real_tg_post('sendMessage', GROUP, {'text': 'x'})
finally:
    ab.urlopen, time.sleep = _keep
assert ok is True, f'429 khong duoc thu lai: ok={ok} err={err}'
assert len(_hits) == 2, f'chi goi Telegram {len(_hits)} lan'
assert _slept == [2], f'khong doi dung retry_after: {_slept}'

# 13) che do c27: ma tran luat theo gio + thu vien nguoi + chan trung lap
def c27(algo, ts, person=None, cam='006', sim=90, lib='Default List'):
    ev = {'kind': 'alarm', 'type': 1, 'algo_model': algo, 'ts': ts,
          'channel_name': cam, 'capture_info': [{}] if person else []}
    if person:
        ev['person'] = {'name': person, 'similarity': sim, 'lib': lib}
    return ab._c27_decide(ev)


# EnterArea + Absence(OffDuty): LUON gui va doi ten (chung khong bao gio co nhan dien)
assert c27('EnterArea', at(3))[0:2] == ('Xâm phạm khu vực', True)
assert c27('OffDutyDetectionAlarm', at(3))[0:2] == \
    ('1 người đã ra khỏi phòng 15 phút trước', True)

# truoc 17:30: vo danh -> chan; nhan dien duoc trong Default List -> gui
assert c27('FieldDetectorObjectsInside', at(10))[1] is False
assert c27('FieldDetectorObjectsInside', at(10), 'HOÀNG ANH')[1] is True
assert c27('FieldDetectorObjectsInside', at(10), 'X', lib='Khac')[1] is False
# sau 17:30: gui ca loai vo danh
assert c27('FieldDetectorObjectsInside', at(18))[1] is True

# cross-line 00:00-08:30: im lang, nhung van ghi lan xuat hien dau
assert c27('LineDetectorCrossed', at(7), 'CHU MINH QUANG')[1] is False
# da den luc 07:00 -> 09:00 vuot vach KHONG bao di muon
assert c27('LineDetectorCrossed', at(9), 'CHU MINH QUANG')[1] is False
# xuat hien lan dau 09:30 -> di muon, dung 1 lan/nguoi/ngay
t, snd, mark = c27('LineDetectorCrossed', at(9, 30), 'NGUYEN VAN A')
assert snd is True and 'đã đi muộn' in t and mark == ('late', 'NGUYEN VAN A'), (t, snd, mark)
ab._c27_mark({'ts': at(9, 30)}, mark)
assert c27('LineDetectorCrossed', at(10), 'NGUYEN VAN A')[1] is False
# sau 17:30 cross-line gui lai binh thuong
assert c27('LineDetectorCrossed', at(18))[1] is True

# uniform: chi khi nhan dien duoc, 1 lan/nguoi/ngay, doi ten
assert c27('WorkClothesAlarm', at(10))[1] is False
t, snd, mark = c27('WorkClothesAlarm', at(10), 'HOÀNG ANH')
assert snd is True and t == 'Sai đồng phục' and mark == ('uniform', 'HOÀNG ANH'), (t, snd, mark)
ab._c27_mark({'ts': at(10)}, mark)
assert c27('WorkClothesAlarm', at(11), 'HOÀNG ANH')[1] is False
# alarm vo danh KHONG duoc danh dau (neu khong se chan oan nguoi that)
c27('WorkClothesAlarm', at(12))
st = ab._c27_load(ab._c27_hm(at(12))[1])
assert st['uniform'] == ['HOÀNG ANH'], st
assert st['late'] == ['NGUYEN VAN A'], st

# doi ngay -> reset het (moc 00:00)
assert c27('WorkClothesAlarm', at(10, day=17), 'HOÀNG ANH')[1] is True
t, snd, mark = c27('LineDetectorCrossed', at(9, 30, day=17), 'NGUYEN VAN A')
assert snd is True and mark == ('late', 'NGUYEN VAN A'), (t, snd, mark)

# lich su xuat hien: lan 1 o camera nao, lan 2 o dau
hist = [json.loads(l) for l in open(ab._C27_LOG, encoding='utf-8')]
q = [h for h in hist if h['person'] == 'CHU MINH QUANG']
assert len(q) == 2 and q[0]['ts'] < q[1]['ts'], q
assert q[0]['cam'] == '006' and q[0]['algo'] == 'LineDetectorCrossed', q
assert not [h for h in hist if h['person'] == 'X'], 'nguoi khac thu vien khong duoc ghi'

print('All tg filters pass.')
