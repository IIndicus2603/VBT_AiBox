from app.box.go2rtc import go2rtc, _creds_from_go2rtc
from app.box import client

import hashlib, http.client, json, re, secrets
from urllib.parse import unquote


def _parse_challenge(hdr):
    """WWW-Authenticate -> dict. Bat ca dang co va khong co ngoac kep (demo Java
    chi bat dang co ngoac -> qop=null -> digest sai)."""
    out = {}
    for k, qv, bv in re.findall(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))', hdr):
        out[k.lower()] = qv or bv
    return out if 'nonce' in out else None


_ONVIF_CHAL = {}                      # host -> (chal, cnonce) — cache digest de khoi 401 moi lenh


def _onvif_digest(host, user, passwd, body, timeout=8):
    """Gui SOAP ONVIF toi camera (digest auth), tra (status, body-xml).

    Cache challenge per-camera: lenh dau 401 -> giai -> luu, lenh sau gui thang
    Authorization khong can 401 lai (quan trong: lenh stop phai toi camera NGAY)."""
    h = lambda s: hashlib.md5(s.encode()).hexdigest()
    path = '/onvif/device_service'
    chal, cnonce = _ONVIF_CHAL.get(host, (None, None))

    def _auth():
        nc = '%08x' % 1
        r1 = h(f'{user}:{chal["realm"]}:{passwd}')
        r2 = h(f'POST:{path}')
        resp = h(f'{r1}:{chal["nonce"]}:{nc}:{cnonce}:{chal.get("qop") or "auth"}:{r2}')
        return (f'Digest username="{user}", realm="{chal["realm"]}", nonce="{chal["nonce"]}", '
                f'uri="{path}", algorithm="{chal.get("algorithm", "MD5")}", '
                f'qop={chal.get("qop") or "auth"}, response="{resp}", nc={nc}, cnonce="{cnonce}"')

    # Da co cache thi gui Auth ngay; chua co thi gui khong Auth de nhan 401 roi lap.
    for attempt in (0, 1):
        hdrs = {'Content-Type': 'application/soap+xml; charset=utf-8',
                'Content-Length': str(len(body))}
        if chal:
            hdrs['Authorization'] = _auth()
        conn = http.client.HTTPConnection(host, 80, timeout=timeout)
        try:
            conn.request('POST', path, body, hdrs)
            r = conn.getresponse(); data, status = r.read(), r.status
            wa = r.getheader('WWW-Authenticate', '')
        finally:
            conn.close()
        if status != 401:
            return status, data
        if attempt == 0:
            ch = _parse_challenge(wa)
            if not ch:
                return status, data
            chal, cnonce = ch, secrets.token_hex(8)
            _ONVIF_CHAL[host] = (chal, cnonce)
    return status, data


def _stream_ip(stream_name):
    """Ten stream go2rtc (ch2) -> IP camera tu /api/streams. None neu khong ro."""
    try:
        _, raw = go2rtc('GET', '/api/streams')
        streams = json.loads(raw or b'{}')
        for p in (streams.get(stream_name) or {}).get('producers') or []:
            m = re.match(r'^rtsp://[^@/]+@([^:/]+)', p.get('url') or '')
            if m:
                return m.group(1)
    except (OSError, ValueError, http.client.HTTPException):
        pass
    return None


def _onvif_body(cmd, token, **kw):
    """SOAP envelope cho ContinuousMove / Stop / SetPreset / GotoPreset.

    Camera UNV cap thap (ch2) khong ho tro GetPosition/GetStatus/AbsoluteMove
    (tra 500 ActionNotSupported) nhung ho tro SetPreset/GotoPreset — nen "luu vi
    tri / ve giua" dung preset rieng 'vh_home' (token 1), KHONG dong cham home goc
    camera (OnvifHomePosition)."""
    t = 'http://www.onvif.org/ver20/ptz/wsdl'
    tt = 'http://www.onvif.org/ver10/schema'
    if cmd == 'move':
        p = kw.get('pan') or 0; q = kw.get('tilt') or 0; z = kw.get('zoom') or 0
        body = (f'<ContinuousMove xmlns="{t}"><ProfileToken>{token}</ProfileToken>'
                f'<Velocity><tt:PanTilt x="{p}" y="{q}"/><tt:Zoom x="{z}"/></Velocity>'
                f'</ContinuousMove>')
    elif cmd == 'stop':
        body = (f'<Stop xmlns="{t}"><ProfileToken>{token}</ProfileToken>'
                f'<PanTilt>true</PanTilt><Zoom>true</Zoom></Stop>')
    elif cmd == 'sethome':
        # Luu vi tri hien tai thanh preset 'vh_home'. Response tra <PresetToken>N</PresetToken>.
        body = (f'<SetPreset xmlns="{t}"><ProfileToken>{token}</ProfileToken>'
                f'<PresetName>vh_home</PresetName></SetPreset>')
    elif cmd == 'getpresets':
        body = (f'<GetPresets xmlns="{t}"><ProfileToken>{token}</ProfileToken>'
                f'</GetPresets>')
    else:  # home — ve preset 'vh_home' (token do kw['preset'] truyen vao).
        body = (f'<GotoPreset xmlns="{t}"><ProfileToken>{token}</ProfileToken>'
                f'<PresetToken>{kw["preset"]}</PresetToken></GotoPreset>')
    return (f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="{tt}">'
            f'<s:Body>{body}</s:Body></s:Envelope>')


def _ptz_profile(ip, user, pwd):
    """GetProfiles -> ProfileToken dau co PTZConfiguration (fallback token dau)."""
    body = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
            '<s:Body><GetProfiles xmlns="http://www.onvif.org/ver20/media/wsdl"/>'
            '</s:Body></s:Envelope>')
    st, xml = _onvif_digest(ip, user, pwd, body)
    if st != 200:
        return None
    txt = (xml or b'').decode('utf-8', 'ignore')
    toks = re.findall(r'token="([^"]+)"', txt)
    if not toks:
        return None
    # Uu tien profile co PTZConfiguration (dua theo vi tri trong chuoi XML).
    for m in re.finditer(r'<tt:Profile\s[^>]*token="([^"]+)"', txt):
        seg = txt[m.start():m.start() + 800]
        if 'PTZConfiguration' in seg:
            return m.group(1)
    return toks[0]


_PTZ_TOKEN_CACHE = {}                    # ip -> ProfileToken (lay 1 lan, dung lai)
_PTZ_PRESET = {}                         # ip -> PresetToken cua 'vh_home'


def _preset_token(ip, user, pwd, token):
    """GetPresets -> PresetToken cua preset ten 'vh_home'. None neu chua luu.
    Khong hardcode token: moi camera cap token khac nhau (ch2: 1, camera khac co
    the khac neu da co preset san)."""
    st, xml = _onvif_digest(ip, user, pwd, _onvif_body('getpresets', token))
    if st != 200:
        return None
    txt = (xml or b'').decode('utf-8', 'ignore')
    # Moi preset la 1 khoi <...Preset token="N"><tt:Name>...</tt:Name>; tim khoi
    # co ten vh_home roi lay token trong the mo dau (namespace prefix tuy camera).
    for m in re.finditer(r'<[A-Za-z0-9]*:?Preset\b[^>]*>', txt):
        seg = txt[m.start():m.start() + 300]
        if '<tt:Name>vh_home</tt:Name>' in seg:
            tm = re.search(r'token="([^"]+)"', m.group(0))
            if tm:
                return tm.group(1)
    return None


def _ptz_cmd(stream_name, cmd, **kw):
    """Gui lenh ONVIF PTZ toi camera: cmd=move|stop|home|set_home|has_home.
    - set_home: SetPreset 'vh_home' — luu vi tri hien tai, khong dong cham home
      goc camera (OnvifHomePosition van giu nguyen).
    - home: GotoPreset ve vh_home. Chua luu lan nao -> bao loi de FE nhac bam luu.
    - has_home: tra {has: bool} cho FE to icon nut luu.
    ProfileToken CACHE lai sau lan dau — moi lenh chi 1 SOAP round-trip (dung
    GetProfiles lai moi lan thi stop den tre, camera xoay them luc do)."""
    ip = _stream_ip(stream_name)
    if not ip:
        return {'code': -1, 'msg': f'khong tim thay IP cua stream {stream_name}'}
    # Credential camera lay tu go2rtc streams (rtsp URL). '%25' da escape -> decode.
    try:
        _, raw = go2rtc('GET', '/api/streams')
        creds = _creds_from_go2rtc(json.loads(raw or b'{}'))
    except (OSError, ValueError, http.client.HTTPException):
        creds = {}
    up = creds.get(ip)
    if not up:
        return {'code': -1, 'msg': f'chua co credential camera {ip}'}
    user, _, pwd = up.partition(':')
    pwd = unquote(pwd)                       # '%25' -> '%'
    token = _PTZ_TOKEN_CACHE.get(ip)
    if not token:
        token = _ptz_profile(ip, user, pwd)
        if not token:
            return {'code': -1, 'msg': f'khong lay duoc ProfileToken camera {ip}'}
        _PTZ_TOKEN_CACHE[ip] = token

    if cmd == 'has_home':
        preset = _PTZ_PRESET.get(ip) or _preset_token(ip, user, pwd, token)
        if preset:
            _PTZ_PRESET[ip] = preset
        return {'code': 0, 'has': bool(preset)}

    if cmd == 'set_home':
        st, xml = _onvif_digest(ip, user, pwd, _onvif_body('sethome', token))
        if st != 200:
            return {'code': -1, 'msg': f'ONVIF HTTP {st}'}
        # Response tra <PresetToken>N</PresetToken> — cache de 'home' khoi tra cuu lai.
        m = re.search(r'PresetToken>([^<]+)<', (xml or b'').decode('utf-8', 'ignore'))
        _PTZ_PRESET[ip] = m.group(1) if m else _preset_token(ip, user, pwd, token)
        return {'code': 0}

    if cmd == 'home':
        preset = _PTZ_PRESET.get(ip) or _preset_token(ip, user, pwd, token)
        if not preset:
            return {'code': -1, 'msg': 'chua luu vi tri — bam nut luu truoc'}
        _PTZ_PRESET[ip] = preset
        body = _onvif_body('home', token, preset=preset)
    else:
        body = _onvif_body(cmd, token, **kw)

    st, xml = _onvif_digest(ip, user, pwd, body)
    if st != 200:
        return {'code': -1, 'msg': f'ONVIF HTTP {st}'}
    if b'Fault' in (xml or b''):
        return {'code': -1, 'msg': 'camera tu choi lenh (co the khong co PTZ)'}
    return {'code': 0}