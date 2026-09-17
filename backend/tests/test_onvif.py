"""Self-checks for the ported onvif backend module, adapted from
D:/test/Unv_Smartbox/aibox.py selftest() lines 2549-2623."""
import base64
import hashlib

import pytest

from app.box import onvif
from app.box import client
from app.box import rsa


def test_client_parse_challenge():
    # aibox.py 2550-2552
    assert client._parse_challenge('Digest qop=auth,realm="R",nonce="123"') == \
        {'qop': 'auth', 'realm': 'R', 'nonce': '123'}, 'challenge khong ngoac kep'
    assert client._parse_challenge('Basic realm="x"') is None


def test_rsa_pubkey():
    # aibox.py 2562-2563
    assert rsa.rsa_pubkey(base64.b64encode(
        bytes([0x30, 0x06, 0x02, 0x01, 0x11, 0x02, 0x01, 0x03])).decode()) == (17, 3)


def test_rsa_512_roundtrip():
    # aibox.py 2568-2585
    p = 0xF7E75FDC469067FFDC4E847C51F452DF        # so nguyen to 128-bit
    q = 0xE85CED54AF57E53E092113E62F436F4F
    n, e = p * q, 65537
    d = pow(e, -1, (p - 1) * (q - 1))

    def der_int(v):                                # INTEGER, chen 0x00 neu bit cao = 1
        b = v.to_bytes((v.bit_length() + 8) // 8, 'big')
        return bytes([0x02, len(b)]) + b

    body = der_int(n) + der_int(e)
    der = bytes([0x30, 0x81, len(body)] if len(body) > 127 else [0x30, len(body)]) + body
    ct = rsa.rsa_encrypt('Imou123456%', base64.b64encode(der).decode())
    em = pow(int.from_bytes(base64.b64decode(ct), 'big'), d, n).to_bytes(32, 'big')
    assert em[0:2] == b'\x00\x02', em[:4].hex()
    sep = em.index(b'\x00', 2)
    assert sep >= 10, f'padding chi {sep - 2} byte, PKCS#1 doi >= 8'
    assert b'\x00' not in em[2:sep], 'padding chua byte 00'
    assert em[sep + 1:] == b'Imou123456%', em[sep + 1:]


def test_go2rtc_creds_and_with_creds():
    # aibox.py 2588-2616
    from app.box.go2rtc import _creds_from_go2rtc, _with_creds
    st = {'cam178': {'producers': [{'url': 'rtsp://admin:UNV123456%25@192.168.21.178:554/ch01'}]}}
    cr = _creds_from_go2rtc(st)
    assert cr == {'192.168.21.178': 'admin:UNV123456%25'}, cr
    got, how = _with_creds('rtsp://192.168.21.178/media/video1', {}, cr)
    assert got == 'rtsp://admin:UNV123456%25@192.168.21.178/media/video1', got
    assert how == 'go2rtc.yaml'
    # '%' tran phai thanh %25 khong thi go2rtc bao "invalid URL escape"
    got, _ = _with_creds('rtsp://10.0.0.9/s', {}, {'10.0.0.9': 'admin:pa%ss'})
    assert got == 'rtsp://admin:pa%25ss@10.0.0.9/s', got
    # BUG THAT: firmware tra '%' TRAN cho UNV/Imou -> go2rtc "invalid URL escape".
    got, how = _with_creds('rtsp://admin:UNV123456%@192.168.21.186:554/ch01', {}, {})
    assert got == 'rtsp://admin:UNV123456%25@192.168.21.186:554/ch01', got
    assert how == 'nguyen ban'
    # da escape san -> khong escape 2 lan thanh %2525
    u = 'rtsp://admin:Dahua123456%25@192.168.21.180:554/cam/realmonitor?channel=1&subtype=0'
    assert _with_creds(u, {}, {})[0] == u
    # query string phai giu nguyen, chi sua truoc '@'
    got, _ = _with_creds('rtsp://admin:Imou123456%@10.0.0.5:554/cam?channel=1&subtype=1', {}, {})
    assert got.endswith('/cam?channel=1&subtype=1'), got
    assert 'Imou123456%25@' in got, got
    # khong biet mat khau -> tra nguyen ban va noi ro, khong doan bua
    assert _with_creds('rtsp://1.2.3.4/s', {}, {})[1] == 'thieu mat khau'
    # URL da co credential -> khong cham vao
    u = 'rtsp://a:b@5.6.7.8/s'
    assert _with_creds(u, {}, {'5.6.7.8': 'x:y'}) == (u, 'nguyen ban')
    # fallback theo ch['ip'] khi host trong rtsp khac IP channel
    assert _with_creds('rtsp://9.9.9.9/s', {'ip': '192.168.21.178'}, cr)[1] == 'go2rtc.yaml'


def test_orphans():
    # aibox.py 2619-2623
    from app.box.go2rtc import _orphans
    assert _orphans(['ch1', 'ch5', 'zz'], [{'channel_id': 1}, {'channel_id': 2}], 100) == ['ch5', 'zz']
    assert _orphans(['ch1', 'ch10'], [{'channel_id': 1}], 1) == []  # list bi cat -> rong
    assert _orphans([], [{'channel_id': 99}], 100) == []
    assert _orphans(['ch3', 'zz_probe', '_probe_1'], [{'channel_id': 1}], 10) == ['ch3', 'zz_probe']


def test_onvif_body():
    # _onvif_body('move', 'tok', pan=1) -> SOAP XML voi ContinuousMove + ProfileToken
    xml = onvif._onvif_body('move', 'tok', pan=1)
    assert '<?xml version="1.0" encoding="UTF-8"?>' in xml
    assert 'ContinuousMove' in xml
    assert 'ProfileToken>tok<' in xml
    # PanTilt vector gan gia tri pan (so 1, khong phai 0.0)
    assert '<tt:PanTilt x="1" y="0"/>' in xml