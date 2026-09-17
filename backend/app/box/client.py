from app import config
CONN = config.CONN

from app.box import rsa

import hashlib, http.client, json, re, secrets, threading


def _parse_challenge(hdr):
    """WWW-Authenticate -> dict. Bat ca dang co va khong co ngoac kep (demo Java
    chi bat dang co ngoac -> qop=null -> digest sai)."""
    out = {}
    for k, qv, bv in re.findall(r'(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))', hdr):
        out[k.lower()] = qv or bv
    return out if 'nonce' in out else None


class Aibox:
    """Mot connection dung lau, cache challenge. Tao moi moi request = 401 moi
    lan + de dung gioi han so login (loi 1002/1003)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.chal = None
        self.nc = 0
        self._login_nonce = None

    def _auth_header(self, method, path):
        c = self.chal
        self.nc += 1
        nc, cnonce = '%08x' % self.nc, secrets.token_hex(8)
        h = lambda s: hashlib.md5(s.encode()).hexdigest()
        qop = c.get('qop', 'auth').split(',')[0].strip()
        r1 = h(f'{CONN["user"]}:{c["realm"]}:{CONN["pass"]}')
        r2 = h(f'{method}:{path}')
        resp = h(f'{r1}:{c["nonce"]}:{nc}:{cnonce}:{qop}:{r2}')
        # qop va nc KHONG co ngoac kep, phan con lai co. Box kho tinh cho nay.
        return (f'Digest username="{CONN["user"]}", realm="{c["realm"]}", nonce="{c["nonce"]}", '
                f'uri="{path}", algorithm="{c.get("algorithm", "MD5")}", qop={qop}, '
                f'response="{resp}", nc={nc}, cnonce="{cnonce}"')

    def raw(self, method, path, body=None, ctype='application/json', hdrs=None):
        payload = body if isinstance(body, bytes) else json.dumps(body or {}).encode()
        for attempt in (1, 2):
            h = {'Content-Type': ctype, 'Content-Length': str(len(payload))}
            if hdrs:
                h.update(hdrs)
            with self.lock:
                if self.chal:
                    h['Authorization'] = self._auth_header(method, path)
            if not CONN['host']:
                raise RuntimeError('chua cau hinh IP cua AIBOX (tab Cau hinh)')
            conn = http.client.HTTPConnection(CONN['host'], CONN['port'], timeout=20)
            try:
                conn.request(method, path, payload, h)
                r = conn.getresponse()
                wa = r.getheader('WWW-Authenticate', '')
                try:
                    data = r.read()
                except http.client.IncompleteRead as e:
                    # Box dong ket noi truoc khi gui du so byte Content-Length hua
                    # (hay gap voi request body lon). Dung lai phan da doc duoc,
                    # khong crash request -> route proxy khoi tra 500 lanh tanh.
                    print(f'[box] IncompleteRead {path}: {e}, dung phan doc duoc')
                    data = e.partial or b''
                status = r.status
            finally:
                conn.close()
            if status == 401 and attempt == 1:
                ch = _parse_challenge(wa)
                if not ch:
                    raise RuntimeError('401 khong kem WWW-Authenticate hop le')
                with self.lock:
                    self.chal, self.nc = ch, 0
                continue
            return status, data
        return status, data

    def call(self, path, body=None):
        status, data = self.raw('POST', path, body)
        try:
            return json.loads(data or b'{}')
        except json.JSONDecodeError:
            return {'code': -1, 'msg': f'HTTP {status}: {data[:200]!r}'}

    def login(self):
        """Login de lay session nonce cua box. DownloadFile /API/V1.0/Smart/DaoRecord/
        Search/DownloadFile doi digest dung dang cua box: cnonce la md5(rand) 32 ky tu
        (khong phai token_hex 16 ky tu) va nc=00000001 co dinh. box.raw dung cnonce
        token_hex + nc tang dan -> System/Time chap nhan nhung DownloadFile tra 60031.
        Login tra HTTP 200 KEM WWW-Authenticate khi chua auth (khong phai 401) nen phai
        tu doc challenge roi gui lai co digest. PHAI kem Custom-Header o ca login."""
        path = '/API/V1.0/System/Security/Login'
        st, wa = self._login_challenge(path)
        if not st or not wa:
            return False
        with self.lock:
            self._login_nonce = wa.get('nonce')
        # gui lai co digest dung dinh dang box + Custom-Header
        hdrs = {'Authorization': self._box_digest('PUT', path, wa),
                'Custom-Header': 'WebLoginHandle=10081124'}
        st, data = self._raw_plain('PUT', path, b'{}', hdrs)
        return st == 200 and b'status_code":\t0' in data[:200]

    def download(self, url):
        """Tai file export tu box qua DownloadFile. Re-login (nonce login moi) roi GET
        file voi digest dung dinh dang box. Tra (http_status, bytes)."""
        if not self.login():
            return 502, b'{"code":-1,"msg":"login that bai"}'
        with self.lock:
            wa = {'realm': 'NVRDVR', 'nonce': self._login_nonce}
        hdrs = {'Authorization': self._box_digest('GET', url, wa),
                'Custom-Header': 'WebLoginHandle=10081124'}
        return self._raw_plain('GET', url, b'', hdrs)

    def _box_digest(self, method, uri, wa):
        """Digest dung dinh dang box (xem HttpRequestHeaders trong bundle box):
        cnonce=md5(rand), nc=00000001 co dinh, qop=auth (khong ngoac)."""
        import time as _t, hashlib as _h
        user = CONN['user']; pwd = CONN['pass']
        realm = wa.get('realm', 'NVRDVR'); nonce = wa.get('nonce')
        h1 = _h.md5(f'{user}:{realm}:{pwd}'.encode()).hexdigest()
        cnonce = _h.md5(f'{_t.time()}_{secrets.token_hex(4)}'.encode()).hexdigest()
        h2 = _h.md5(f'{method}:{uri}'.encode()).hexdigest()
        nc = '00000001'
        resp = _h.md5(f'{h1}:{nonce}:{nc}:{cnonce}:auth:{h2}'.encode()).hexdigest()
        return (f'Digest username="{user}", realm="{realm}", nonce="{nonce}", '
                f'algorithm="MD5", qop=auth, nc={nc}, cnonce="{cnonce}", '
                f'uri="{uri}", response="{resp}"')

    def _login_challenge(self, path):
        """Goi PUT Login khong auth -> tra (True, challenge) neu co WWW-Authenticate.
        Kem Custom-Header giong web box; LAY NONCE PHAI GUI BODY RONG (Content-Length 0)."""
        st, data, wa = self._raw_plain_full('PUT', path, b'',
                                            {'Custom-Header': 'WebLoginHandle=10081124'})
        ch = _parse_challenge(wa)
        return (True, ch) if ch else (False, None)

    def _raw_plain(self, method, path, body, hdrs):
        st, data, _ = self._raw_plain_full(method, path, body, hdrs)
        return st, data

    def _raw_plain_full(self, method, path, body, hdrs):
        """Gui 1 request thang (khong tu retry 401) — dung cho login/download vi box
        khong lam 401 challenge cho nhung endpoint nay."""
        import http.client
        if not CONN['host']:
            raise RuntimeError('chua cau hinh IP cua AIBOX (tab Cau hinh)')
        h = {'Content-Type': 'application/json', 'Content-Length': str(len(body))}
        h.update(hdrs)
        conn = http.client.HTTPConnection(CONN['host'], CONN['port'], timeout=60)
        try:
            conn.request(method, path, body, h)
            r = conn.getresponse()
            data = r.read()
            wa = r.getheader('WWW-Authenticate', '')
        finally:
            conn.close()
        return r.status, data, wa


box = Aibox()