#!/usr/bin/env python3
"""Verify ported pure-logic modules in app/box against aibox.py selftest()
values (aibox.py lines 2549-2628). Covers:
  - client._parse_challenge
  - rsa.rsa_pubkey / rsa.rsa_encrypt (512-bit PKCS#1 v1.5 roundtrip)
  - go2rtc._creds_from_go2rtc / _with_creds / _orphans   (NOT ported yet)
  - onvif._onvif_body                                      (import blocked)

rsa and client are pure logic and import cleanly. go2rtc and onvif depend on
app.box.go2rtc, which does NOT exist in the port -> their modules fail to import.
We assert the import to surface that gap explicitly rather than silently skip.
"""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.box import rsa                                    # noqa: E402
from app.box.client import _parse_challenge                # noqa: E402


# ---- client: _parse_challenge (aibox.py 2550-2552) ---------------------------
def test_parse_challenge_quoted():
    assert _parse_challenge('Digest qop=auth,realm="R",nonce="123"') == \
        {'qop': 'auth', 'realm': 'R', 'nonce': '123'}


def test_parse_challenge_basic_is_none():
    assert _parse_challenge('Basic realm="x"') is None


# ---- rsa: pubkey parse + 512-bit PKCS#1 v1.5 roundtrip (aibox.py 2562-2585) ---
def test_rsa_pubkey_der():
    assert rsa.rsa_pubkey(base64.b64encode(
        bytes([0x30, 0x06, 0x02, 0x01, 0x11, 0x02, 0x01, 0x03])).decode()) == (17, 3)


def test_rsa_roundtrip_512bit():
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


def test_rsa_encrypt_too_long_raises():
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


# ---- go2rtc: NOT PORTED (aibox.py 2587-2623) --------------------------------
def test_go2rtc_module_exists():
    """aibox.selftest checks _creds_from_go2rtc/_with_creds/_orphans; the port
    never created app/box/go2rtc.py, so onvif.py can't even import."""
    try:
        from app.box import go2rtc  # noqa: F401
    except ModuleNotFoundError as exc:
        pytest.fail(f'app.box.go2rtc missing in port: {exc}')


# ---- onvif: _onvif_body (aibox.py 2568-?; import blocked by missing go2rtc) ---
def test_onvif_body_import_and_move():
    try:
        from app.box.onvif import _onvif_body
    except ModuleNotFoundError as exc:
        pytest.fail(f'app.box.onvif fails to import (app.box.go2rtc missing): {exc}')
    xml = _onvif_body('move', 'tok', pan=1)
    assert '<?xml version="1.0" encoding="UTF-8"?>' in xml
    assert 'ContinuousMove' in xml
    assert 'ProfileToken>tok</ProfileToken>' in xml
    assert 'http://www.onvif.org/ver20/ptz/wsdl' in xml