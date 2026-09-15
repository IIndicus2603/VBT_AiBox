"""Quick smoke test for _tg_forward filters: keepalive + AreaRuleData + video leak."""
import types, sys, os
os.chdir(os.path.dirname(__file__) or '.')

# Stub out heavy deps so aibox.py can be imported without starting a server
for mod in ('go2rtc',):
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

import aibox as ab

calls = []
def fake_send_all(method, fields, files=None):
    calls.append((method, fields))

ab._tg_send_all = fake_send_all
ab._tg_video = lambda fn: (fn, b'x', 'video/mp4')   # file khong ton tai -> that bai gia
ab._tg_pending.clear()

# 1) type 6 (keepalive) should be skipped
calls.clear()
ab._tg_forward({'kind': 'alarm', 'type': 6, 'algo_model': 'foo', 'ts': 1})
assert not calls, f'keepalive sent: {calls}'

# 2) AreaRuleData should be skipped
calls.clear()
ab._tg_forward({'kind': 'alarm', 'type': 1, 'algo_model': 'AreaRuleData', 'ts': 2})
assert not calls, f'AreaRuleData sent: {calls}'

# 3) video with no pending should NOT send (was a leak)
calls.clear()
ab._tg_forward({'kind': 'video', 'video_uuid': 'orphan', 'file': 'x.mp4'})
assert not calls, f'orphan video sent: {calls}'

# 4) video WITH pending should send once
calls.clear()
ab._tg_pending['ok-uuid'] = 'Test caption'
ab._tg_forward({'kind': 'video', 'video_uuid': 'ok-uuid', 'file': 'good.mp4'})
assert calls and calls[0][0] == 'sendVideo', f'pending video not sent: {calls}'

# 5) alarm khong co anh/video -> IM LANG (khong gui text-only nua)
calls.clear()
ab._tg_video_url = lambda ev: None
ab._tg_image = lambda ev: None
ab._tg_forward({'kind': 'alarm', 'type': 1, 'algo_model': 'OffDutyDetectionAlarm', 'ts': 3})
assert not calls, f'text-only alarm sent: {calls}'

print('All tg filters pass.')
