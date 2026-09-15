"""Kiem tra _update_channel: sua RTSP tren box ma khong lo mat khau.

Chay: python test_edit_channel.py
"""
import aibox

SENT = []


class FakeBox:
    def call(self, path, body=None):
        SENT.append((path, body))
        return {'code': 0, 'msg': 'Succeed'}


def setup():
    SENT.clear()
    aibox.box = FakeBox()


update = lambda req: aibox.Handler._update_channel(None, req)
RAW = 'rtsp://admin:UNV123456%@192.168.21.179:554/ch01'
RAW_ESC = 'rtsp://admin:UNV123456%25@192.168.21.179:554/ch01'


def t_type2_payload():
    setup()
    r = update({'channel_id': 2, 'channel_name': 'Cam sửa', 'rtsp': RAW,
                'transport_type': 2, 'custom_code': 'gate-a'})
    assert r['code'] == 0, r
    assert SENT == [('/api/v2/channel/update', {
        'channel_id': 2, 'channel_name': 'Cam sửa', 'type': 2,
        'rtsp': RAW_ESC, 'transport_type': 2, 'custom_code': 'gate-a',
    })], SENT


def t_validation_rejects_before_box():
    for bad in [
        {'channel_name': 'cam', 'rtsp': RAW},
        {'channel_id': 2, 'channel_name': '  ', 'rtsp': RAW},
        {'channel_id': 2, 'channel_name': 'x' * 65, 'rtsp': RAW},
        {'channel_id': 2, 'channel_name': 'cam', 'rtsp': 'rtsp://' + 'x' * 1030},
        {'channel_id': 2, 'channel_name': 'cam'},
    ]:
        setup()
        assert update(bad)['code'] == 2, bad
        assert not SENT, bad


if __name__ == '__main__':
    for _, fn in sorted(globals().items()):
        if callable(fn) and fn.__name__.startswith('t_'):
            fn()
            print('ok', fn.__name__)
    print('edit_channel selftest ok')
