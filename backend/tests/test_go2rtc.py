#!/usr/bin/env python3
"""Self-checks for app.box.go2rtc, ported from aibox.py selftest() lines 2588-2623.

Covers the module's own pure-logic functions:
  - _creds_from_go2rtc   (aibox.py 2588-2590)
  - _with_creds          (aibox.py 2591-2616)
  - _orphans             (aibox.py 2619-2623)

client (_parse_challenge), rsa (rsa_pubkey/rsa_encrypt) and onvif (_onvif_body)
live in sibling modules app.box.{client,rsa,onvif} and are covered by their own
test files (test_client.py / test_rsa.py / test_onvif.py).
"""
from app.box.go2rtc import _creds_from_go2rtc, _with_creds, _orphans


# ---- _creds_from_go2rtc: {ip: 'user:pass'} suy ra tu rtsp tran da khai (2588) --
def test_creds_from_go2rtc():
    st = {'cam178': {'producers': [{'url': 'rtsp://admin:UNV123456%25@192.168.21.178:554/ch01'}]}}
    assert _creds_from_go2rtc(st) == {'192.168.21.178': 'admin:UNV123456%25'}


# ---- _with_creds: ghep credential vao rtsp tran, '%' -> %25 (2591-2616) ------
def test_with_creds_go2rtc_yaml():
    cr = {'192.168.21.178': 'admin:UNV123456%25'}
    got, how = _with_creds('rtsp://192.168.21.178/media/video1', {}, cr)
    assert got == 'rtsp://admin:UNV123456%25@192.168.21.178/media/video1', got
    assert how == 'go2rtc.yaml', how


def test_with_creds_escape_percent_but_not_double():
    got, _ = _with_creds('rtsp://10.0.0.9/s', {}, {'10.0.0.9': 'admin:pa%ss'})
    assert got == 'rtsp://admin:pa%25ss@10.0.0.9/s', got
    u = 'rtsp://admin:Dahua123456%25@192.168.21.180:554/cam/realmonitor?channel=1&subtype=0'
    assert _with_creds(u, {}, {})[0] == u


def test_with_creds_already_has_credential_only_escape():
    got, how = _with_creds('rtsp://admin:UNV123456%@192.168.21.186:554/ch01', {}, {})
    assert got == 'rtsp://admin:UNV123456%25@192.168.21.186:554/ch01', got
    assert how == 'nguyen ban', how


def test_with_creds_keeps_query_string():
    got, _ = _with_creds('rtsp://admin:Imou123456%@10.0.0.5:554/cam?channel=1&subtype=1', {}, {})
    assert got.endswith('/cam?channel=1&subtype=1'), got
    assert 'Imou123456%25@' in got, got


def test_with_creds_no_password_and_untouched():
    assert _with_creds('rtsp://1.2.3.4/s', {}, {})[1] == 'thieu mat khau'
    u = 'rtsp://a:b@5.6.7.8/s'
    assert _with_creds(u, {}, {'5.6.7.8': 'x:y'}) == (u, 'nguyen ban')


def test_with_creds_fallback_to_ch_ip():
    cr = {'192.168.21.178': 'admin:UNV123456%25'}
    assert _with_creds('rtsp://9.9.9.9/s', {'ip': '192.168.21.178'}, cr)[1] == 'go2rtc.yaml'


# ---- _orphans: luong khong co channel tren box la ruong (2619-2623) ----------
def test_orphans_removes_streams_without_channel():
    assert _orphans(['ch1', 'ch5', 'zz'], [{'channel_id': 1}, {'channel_id': 2}], 100) == ['ch5', 'zz']


def test_orphans_truncated_list_is_empty():
    assert _orphans(['ch1', 'ch10'], [{'channel_id': 1}], 1) == []


def test_orphans_empty_names():
    assert _orphans([], [{'channel_id': 99}], 100) == []


def test_orphans_skips_probe_streams():
    assert _orphans(['ch3', 'zz_probe', '_probe_1'], [{'channel_id': 1}], 10) == ['ch3', 'zz_probe']