#!/usr/bin/env python3
"""Pure-logic self-checks for the ported `client` backend module.

Ported from D:/test/Unv_Smartbox/aibox.py selftest() (lines 2549-2628). The
monolith was split into app/box/client.py, app/box/rsa.py, app/box/onvif.py,
app/box/go2rtc.py. The go2rtc helpers (_creds_from_go2rtc, _with_creds,
_orphans) were expected to live in app/box/go2rtc.py, and onvif.py imports
them. Those are reported separately so a missing go2rtc.py shows up as a real
porting failure rather than being silently dropped.
"""
import base64
import hashlib

import pytest

from app.box import client, rsa


# ---------------------------------------------------------------- client
def test_parse_challenge_quoted():
    assert client._parse_challenge(
        'Digest qop=auth,realm="R",nonce="123"'
    ) == {'qop': 'auth', 'realm': 'R', 'nonce': '123'}


def test_parse_challenge_basic_is_none():
    assert client._parse_challenge('Basic realm="x"') is None


# ---------------------------------------------------------------- rsa
def test_rsa_pubkey():
    assert rsa.rsa_pubkey(base64.b64encode(
        bytes([0x30, 0x06, 0x02, 0x01, 0x11, 0x02, 0x01, 0x03])).decode()) == (17, 3)


def test_rsa_roundtrip_512():
    p = 0xF7E75FDC469067FFDC4E847C51F452DF
    q = 0xE85CED54AF57E53E092113E62F436F4F
    n, e = p * q, 65537
    d = pow(e, -1, (p - 1) * (q - 1))

    def der_int(v):
        b = v.to_bytes((v.bit_length() + 8) // 8, 'big')
        return bytes([0x02, len(b)]) + b

    body = der_int(n) + der_int(e)
    der = bytes([0x30, 0x81, len(body)] if len(body) > 127 else [0x30, len(body)]) + body
    ct = rsa.rsa_encrypt('Imou123456%', base64.b64encode(der).decode())
    em = pow(int.from_bytes(base64.b64decode(ct), 'big'), d, n).to_bytes(32, 'big')
    assert em[0:2] == b'\x00\x02'
    sep = em.index(b'\x00', 2)
    assert sep >= 10, f'padding chi {sep - 2} byte, PKCS#1 doi >= 8'
    assert b'\x00' not in em[2:sep]
    assert em[sep + 1:] == b'Imou123456%'


def test_rsa_message_too_long_raises():
    p = 0xF7E75FDC469067FFDC4E847C51F452DF
    q = 0xE85CED54AF57E53E092113E62F436F4F
    n, e = p * q, 65537

    def der_int(v):
        b = v.to_bytes((v.bit_length() + 8) // 8, 'big')
        return bytes([0x02, len(b)]) + b

    body = der_int(n) + der_int(e)
    der = bytes([0x30, 0x81, len(body)] if len(body) > 127 else [0x30, len(body)]) + body
    with pytest.raises(ValueError):
        rsa.rsa_encrypt('x' * 40, base64.b64encode(der).decode())


# ---------------------------------------------------------------- go2rtc
def test_go2rtc_helpers_importable():
    """The go2rtc helpers were expected to be ported into app/box/go2rtc.py.
    onvif.py imports from it, so a missing module is a hard porting failure."""
    import app.box.go2rtc as g
    assert callable(g._creds_from_go2rtc)
    assert callable(g._with_creds)
    assert callable(g._orphans)


# ---------------------------------------------------------------- onvif
def test_onvif_module_imports():
    """onvif.py is pure-logic (its _onvif_body builds SOAP XML) but imports the
    go2rtc module at top level; a missing go2rtc.py breaks the whole import."""
    import app.box.onvif as o
    body = o._onvif_body('move', 'tok', pan=1)
    assert '<?xml version="1.0"' in body
    assert '<ContinuousMove' in body
    assert '<ProfileToken>tok</ProfileToken>' in body
    assert 'onvif.org/ver20/ptz/wsdl' in body