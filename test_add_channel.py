"""Kiem tra _add_channel: dieu kien bat buoc cua /api/v2/channel/add (muc 4.3)
va quy tac gui rtsp NGUYEN VAN cho box.

Chay: python test_add_channel.py
"""
import aibox

SENT = []


class FakeBox:
    """Ghi lai payload, khong cham box that."""
    def __init__(self, add_code=0):
        self.add_code = add_code

    def call(self, path, body=None):
        SENT.append((path, body))
        if path == '/api/v2/channel/add':
            if self.add_code:
                return {'code': self.add_code, 'msg': 'fail'}
            return {'code': 0, 'msg': 'Succeed', 'data': {'channel_id': 11}}
        if path == '/api/v2/rsa/publickey':
            return {'code': 0, 'data': {'public_key': 'FAKE'}}
        if path == '/api/v2/channel/device/info':
            return {'code': 0, 'data': {'video': [{'id': 1, 'rtsp': 'rtsp://x/1'}]}}
        return {'code': -1, 'msg': 'unexpected ' + path}

    def raw(self, *a, **k):
        raise AssertionError('khong duoc goi raw trong test nay')


SYNCED = []


def setup(add_code=0):
    SENT.clear()
    SYNCED.clear()
    aibox.box = FakeBox(add_code)
    aibox.rsa_encrypt = lambda pwd, key: 'RSA(' + pwd + ')'
    aibox.sync_streams = lambda: SYNCED.append(1) or {'code': 0, 'added': ['ch11']}


add = lambda req: aibox.Handler._add_channel(None, req)   # method khong dung self

RAW = 'rtsp://admin:UNV123456%@192.168.21.179:554/ch01'   # '%' tran nhu nguoi dung nhap
RAW_ESC = 'rtsp://admin:UNV123456%25@192.168.21.179:554/ch01'   # phai gui dang nay


def t_type2_payload():
    setup()
    r = add({'channel_name': '009', 'rtsp': RAW, 'transport_type': 1})
    assert r['code'] == 0, r
    assert r['data']['channel_id'] == 11, r
    assert len(SENT) == 1 and SENT[0][0] == '/api/v2/channel/add', SENT
    body = SENT[0][1]
    # Dung 4 field, khong thua: type=2 KHONG can RSA / device/info / ip / pwd.
    assert body == {'type': 2, 'channel_name': '009', 'rtsp': RAW_ESC,
                    'transport_type': 1}, body
    # QUAN TRONG NHAT: box percent-decode rtsp truoc khi luu -> gui '%25' (khong phai
    # raw '%'). Bang chung: raw 'Dahua123456%@' bi box tu choi 60062, '...%25@' code 0.
    assert '%25@' in body['rtsp'] and '%@' not in body['rtsp'], body['rtsp']
    assert SYNCED, 'thanh cong phai sync_streams de go2rtc co luong ch<id>'


def t_defaults():
    setup()
    add({'channel_name': 'a', 'rtsp': RAW})
    assert SENT[0][1]['transport_type'] == 1, 'AIBOX bat buoc transport_type, mac dinh tcp'
    setup()
    add({'channel_name': 'a', 'rtsp': RAW, 'custom_code': 'X' * 90})
    assert len(SENT[0][1]['custom_code']) == 64, 'custom_code max 64'


def t_validation():
    for bad, why in [
        ({'rtsp': RAW}, 'thieu channel_name'),
        ({'channel_name': '  ', 'rtsp': RAW}, 'channel_name rong'),
        ({'channel_name': 'x' * 65, 'rtsp': RAW}, 'channel_name > 64'),
        ({'channel_name': 'a', 'rtsp': 'rtsp://' + 'x' * 1030}, 'rtsp > 1023 byte'),
        ({'channel_name': 'a'}, 'khong rtsp khong ip'),
    ]:
        setup()
        r = add(bad)
        assert r['code'] == 2, (why, r)
        assert not SENT, (why, 'tu choi thi khong duoc goi box')
        assert not SYNCED, (why, 'that bai thi khong sync')
    # Bien: dung 64 ky tu, co dau cach -> vendor web cho phep
    setup()
    assert add({'channel_name': 'x'*64, 'rtsp': RAW})['code'] == 0, '64 ky tu phai pass'
    setup()
    assert add({'channel_name': 'Cổng chính', 'rtsp': RAW})['code'] == 0, 'dau cach phai pass theo vendor web'


def t_box_rejects():
    setup(add_code=400316)                            # vuot gioi han 16 channel
    r = add({'channel_name': 'a', 'rtsp': RAW})
    assert r['code'] == 400316, r
    assert not SYNCED, 'box tu choi thi khong sync'


def t_type1_still_works():
    setup()
    r = add({'channel_name': 'cam-onvif', 'ip': '192.168.21.200', 'port': 80,
             'username': 'admin', 'pwd': 'secret', 'video_type': 1})
    assert r['code'] == 0, r
    assert [p for p, _ in SENT] == ['/api/v2/rsa/publickey',
                                    '/api/v2/channel/device/info',
                                    '/api/v2/channel/add'], SENT
    body = SENT[-1][1]
    assert body['type'] == 1 and body['pwd'] == 'RSA(secret)', body
    assert body['ip'] == '192.168.21.200' and body['transport_type'] == 1, body
    assert 'video_id' not in body, 'video_id chi bat buoc khi video_type=2'


def t_type1_custom_stream_needs_video_id():
    setup()
    add({'channel_name': 'c', 'ip': '1.2.3.4', 'video_type': 2})
    assert SENT[-1][1]['video_id'] == 1, 'video_type=2 phai kem video_id tu device/info'


if __name__ == '__main__':
    for fn in [v for k, v in sorted(globals().items()) if k.startswith('t_')]:
        fn()
        print('ok', fn.__name__)
    print('add_channel selftest ok')
