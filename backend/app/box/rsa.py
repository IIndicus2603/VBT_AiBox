#!/usr/bin/env python3
"""RSA: pubkey parse + PKCS#1 v1.5 encrypt, ported from aibox.py lines 271-321.
Pure functions, stdlib only."""
import base64
import re
import secrets


def _asn1(buf, i):
    tag, ln = buf[i], buf[i + 1]
    i += 2
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(buf[i:i + n], 'big')
        i += n
    return tag, buf[i:i + ln], i + ln


def rsa_pubkey(txt):
    """(n, e) tu PEM hoac base64 DER, ca SPKI lan PKCS#1 raw.
    ponytail: doc KHONG noi key format hay padding -> lay 2 INTEGER lon nhat.
    Neu box tra key dang khac (modulus hex, JSON...) thi sua rieng cho no."""
    b = base64.b64decode(re.sub(r'-----[^-]*-----|\s', '', txt) + '===')

    def ints(buf):
        out, i = [], 0
        while i < len(buf) - 1:
            t, v, i = _asn1(buf, i)
            if t == 0x30:
                out += ints(v)
            elif t == 0x03:
                out += ints(v[1:])          # BIT STRING: bo byte unused-bits
            elif t == 0x02:
                out.append(int.from_bytes(v, 'big'))
        return out

    vs = ints(b)
    if not vs:
        raise ValueError('khong parse duoc public key')
    n = max(vs)
    rest = [v for v in vs if v != n]
    return n, (min(rest) if rest else 65537)


def rsa_encrypt(pwd, pubkey):
    """PKCS#1 v1.5 bang pow(). ponytail: neu box dung OAEP thi /channel/device/info
    tra code != 0 -> doi sang OAEP (can hashlib, ~15 dong nua)."""
    n, e = rsa_pubkey(pubkey)
    k, m = (n.bit_length() + 7) // 8, pwd.encode()
    if len(m) > k - 11:
        raise ValueError('mat khau qua dai cho key nay')
    ps = bytearray()
    while len(ps) < k - 3 - len(m):
        c = secrets.token_bytes(1)
        if c != b'\x00':
            ps += c
    em = b'\x00\x02' + bytes(ps) + b'\x00' + m
    ct = pow(int.from_bytes(em, 'big'), e, n).to_bytes(k, 'big')
    return base64.b64encode(ct).decode()