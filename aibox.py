#!/usr/bin/env python3
"""AIBOX bridge: digest-auth proxy + alarm receiver + go2rtc sync. Stdlib only.

  set AIBOX_HOST=192.168.21.200 & set AIBOX_PASS=xxx & python aibox.py
  -> http://127.0.0.1:8090/  (UI)   go2rtc duoc bridge tu mo o :1984
"""
import base64, hashlib, http.client, io, json, os, queue, re, secrets, subprocess, sys, threading, time
from email.parser import BytesParser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PORT      = int(os.environ.get('BRIDGE_PORT', '8090'))
GO2RTC    = os.environ.get('GO2RTC', '127.0.0.1:1984')
# _MEIPASS = PyInstaller onefile temp dir (read-only, bundled assets);
# HERE = bundle dir (go2rtc.exe, ui/); DATA = writable dir (config, alarms, logs).
HERE      = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
DATA      = os.environ.get('AIBOX_DATA', HERE)
UI_DIR    = os.path.join(HERE, 'ui')
ALARM_DIR = os.path.join(DATA, 'alarms')
CONF      = os.path.join(DATA, 'aibox.conf.json')
GO2RTC_EXE = os.path.join(HERE, 'go2rtc.exe' if os.name == 'nt' else 'go2rtc')
GO2RTC_LOG = os.path.join(DATA, 'go2rtc.log')
# Chi tu spawn khi GO2RTC tro ve may nay; tro sang may khac thi may do tu lo.
GO2RTC_LOCAL = GO2RTC.rsplit(':', 1)[0] in ('127.0.0.1', 'localhost', '::1', '')

# Thong tin ket noi box: sua duoc luc dang chay qua tab Cau hinh, khong phai
# hardcode. Env var chi la gia tri mac dinh cho lan dau.
CONN = {'host': os.environ.get('AIBOX_HOST', ''),
        'port': int(os.environ.get('AIBOX_PORT', '80')),
        'user': os.environ.get('AIBOX_USER', 'admin'),
        'pass': os.environ.get('AIBOX_PASS', ''),
        # Telegram: gui anh/video + thong tin canh bao vao NHIEU nhom (tick chon).
        # Token = secret, dung commit. tg_chats = list chat_id dang chon gui den.
        'tg_token': os.environ.get('TG_BOT_TOKEN', ''),
        'tg_chats': [c.strip() for c in os.environ.get('TG_CHAT_IDS', '').split(',') if c.strip()],
        # tg_setup: chat_id -> {'mode':'all'|'rule', 'name':ten, 'algos':[algo_model]}.
        # Nhom KHONG co mat o day = chua /setup = khong nhan alarm nao.
        'tg_setup': {}}


def load_conf():
    """CANH BAO: mat khau luu dang PLAINTEXT trong aibox.conf.json. File nay chmod
    600 tren POSIX; tren Windows quyen thua tu thu muc. Dung .gitignore cho no."""
    try:
        with open(CONF, encoding='utf-8') as f:
            disk = json.load(f)
        CONN.update({k: v for k, v in disk.items() if k in CONN})
        CONN['port'] = int(CONN['port'] or 80)
        # tg_chats luon la list[str]; migrate tu tg_chat cu (1 nhom) neu co.
        if not isinstance(CONN.get('tg_chats'), list):
            CONN['tg_chats'] = []
        CONN['tg_chats'] = [str(c).strip() for c in CONN['tg_chats'] if str(c).strip()]
        if not CONN['tg_chats'] and str(disk.get('tg_chat', '')).strip():
            CONN['tg_chats'] = [str(disk['tg_chat']).strip()]
        # tg_setup luon la dict[str, dict]; bo entry rac de _tg_targets khong vo.
        if not isinstance(CONN.get('tg_setup'), dict):
            CONN['tg_setup'] = {}
        CONN['tg_setup'] = {str(k): v for k, v in CONN['tg_setup'].items()
                            if isinstance(v, dict)}
    except (OSError, ValueError, json.JSONDecodeError):
        pass


def save_conf():
    with open(CONF, 'w', encoding='utf-8') as f:
        json.dump(CONN, f, indent=1)
    try:
        os.chmod(CONF, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------- digest auth
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

    def raw(self, method, path, body=None, ctype='application/json'):
        payload = body if isinstance(body, bytes) else json.dumps(body or {}).encode()
        for attempt in (1, 2):
            hdrs = {'Content-Type': ctype, 'Content-Length': str(len(payload))}
            with self.lock:
                if self.chal:
                    hdrs['Authorization'] = self._auth_header(method, path)
            if not CONN['host']:
                raise RuntimeError('chua cau hinh IP cua AIBOX (tab Cau hinh)')
            conn = http.client.HTTPConnection(CONN['host'], CONN['port'], timeout=20)
            try:
                conn.request(method, path, payload, hdrs)
                r = conn.getresponse()
                data, status = r.read(), r.status
                wa = r.getheader('WWW-Authenticate', '')
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


box = Aibox()


def parse_discover(resp):
    """Parse ket qua DiscoverDevice tra ve [{ip,port,manufacturer,addr}, ...]"""
    if resp.get('status_code') != 0:
        return []
    out = []
    for d in (resp.get('data') or {}).get('DeviceInfoList') or []:
        ip = d.get('IP')
        if not ip:
            continue
        out.append({
            'ip': ip,
            'port': d.get('Port'),
            'manufacturer': d.get('Manufacturer', ''),
            'addr': ip if d.get('AccessProtocolType') != 3 else ip + '(' + d.get('DevID', '') + ')',
        })
    return out


def lan_ip():
    """IP cua may nay ma BOX toi duoc. Khong dung gethostbyname (tra 127.0.0.1 hoac
    IP cua adapter sai khi may co nhieu NIC) — mo UDP socket ve phia box de HDH tu
    chon route dung."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((CONN['host'] or '8.8.8.8', CONN['port'] or 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def conn_info():
    """Trang thai ket noi cho UI. KHONG tra mat khau, chi tra da-co-hay-chua."""
    return {'host': CONN['host'], 'port': CONN['port'], 'user': CONN['user'],
            'has_pass': bool(CONN['pass']), 'lan_ip': lan_ip(), 'bridge_port': PORT,
            # tg_token la secret -> chi bao da-co; tg_chats khong nhay cam, tra nguyen.
            'has_tg': bool(CONN['tg_token'] and CONN.get('tg_chats')),
            'tg_chats': CONN.get('tg_chats') or []}


# ------------------------------------------------------------ RSA PKCS#1 v1.5
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


# ------------------------------------------------------------------ go2rtc sync
def go2rtc(method, path, body=None):
    conn = http.client.HTTPConnection(GO2RTC, timeout=10)
    try:
        conn.request(method, path, body, {'Content-Type': 'application/json'})
        r = conn.getresponse()
        return r.status, r.read()
    finally:
        conn.close()


def _go2rtc_up():
    """True khi :1984 tra loi. Tai dung go2rtc() de khong them import socket."""
    try:
        go2rtc('GET', '/api/streams')
        return True
    except (OSError, http.client.HTTPException):
        return False


def _spawn_go2rtc():
    """go2rtc.exe doc go2rtc.yaml theo CWD -> cwd=HERE la bat buoc. Thieu no thi
    go2rtc van bind :1984 (watchdog tuong la song) nhung khong co stream nao."""
    if not os.path.exists(GO2RTC_EXE):
        print(f'! khong thay {GO2RTC_EXE}\n  -> tu chay go2rtc o {GO2RTC}')
        return False
    log = open(GO2RTC_LOG, 'ab', buffering=0)
    try:
        kw = {'cwd': HERE, 'stdin': subprocess.DEVNULL, 'stdout': log, 'stderr': log}
        if os.name == 'nt':
            kw['creationflags'] = 0x08000000      # CREATE_NO_WINDOW
        subprocess.Popen([GO2RTC_EXE], **kw)
    finally:
        log.close()      # con da dup handle roi, dong ban cua cha cho khoi ro
    return True


def go2rtc_watchdog():
    """Bridge :8090 con song -> :1984 phai song. go2rtc chet (hoac chua ai mo) thi
    tu khoi dong lai. Thread daemon: chet theo bridge, khong ngan bridge thoat."""
    fail = 0
    while True:
        if not GO2RTC_LOCAL or _go2rtc_up():
            fail = 0
            time.sleep(15)
            continue
        fail += 1
        # ponytail: 3 lan lien tiep ma van chet = exe/yaml hong, spawn mai chi lam
        # day go2rtc.log. Lui 5 phut roi thu lai de nguoi dung sua xong khoi restart.
        if fail > 3:
            print(f'! go2rtc khong day duoc {fail - 1} lan lien tiep -> tam ngung, xem {GO2RTC_LOG}')
            fail = 0
            time.sleep(300)
            continue
        print(f'go2rtc khong song o {GO2RTC} -> mo {os.path.basename(GO2RTC_EXE)}')
        _spawn_go2rtc()
        time.sleep(5)       # cho no bind :1984 truoc khi vong ke tiep kiem tra lai


def _creds_from_go2rtc(streams):
    """{ip: 'user:pass'} suy ra tu cac stream DA khai trong go2rtc.yaml.

    TAI LIEU noi box khong bao gio tra mat khau camera (chi `pwd` RSA, mot chieu),
    NHUNG firmware that ECS_B501_SF-B1103.6.5.260211 thi CO: /channel/list tra ve
    `rtsp://admin:<mat khau cleartext>@...` — 8/8 channel trong chl.json deu vay.
    Nen ham nay la FALLBACK cho firmware tra URL TRAN khong credential: _with_creds()
    uu tien credential co san trong rtsp truoc, chi dung den day khi URL khong co '@'.

    He qua bao mat: /aibox/channel/list lam lo mat khau camera dang cleartext. Truoc
    day chan duoc nho _local_only() (moi route ngoai /alarm chi nhan localhost).
    _local_only() gio DA MO LAN -> mat khau camera lo cho ca mang.

    HAI duong ro ri, ca hai deu tra URL tran:
      1. GET /aibox/channel/list  (route nay, di qua box)
      2. GET :1984/api/streams    (go2rtc tra thang tu go2rtc.yaml)
    Bit lai thi mask o ca hai; khong lien quan gi den dang nhap."""
    out = {}
    for o in (streams or {}).values():
        for p in (o.get('producers') or []):
            m = re.match(r'^rtsp://([^:@/]+:[^@/]*)@([^:/]+)', p.get('url') or '')
            if m:
                out.setdefault(m.group(2), m.group(1))
    return out


def _esc_userinfo(rtsp):
    """'%' tran trong user:pass -> %25. Firmware that tra 'UNV123456%@...' (khong
    escape) trong khi Dahua tra 'Dahua123456%25@...' (da escape) -> go2rtc bao
    "invalid URL escape" va stream chet. Chi sua trong phan userinfo truoc '@',
    khong cham path/query (subtype=1 phai giu nguyen)."""
    return re.sub(r'^(rtsp://)([^@/]*)@',
                  lambda m: m.group(1) + re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', m.group(2)) + '@',
                  rtsp)


def _with_creds(rtsp, ch, creds):
    """Chen user:pass vao rtsp tran. Thu tu uu tien: credential da biet cho dung IP
    do -> username tu /channel/list + mat khau cua box. '%' phai thanh %25 khong
    thi go2rtc parse URL fail ("invalid URL escape")."""
    if not rtsp.startswith('rtsp://'):
        return rtsp, 'nguyen ban'
    if '@' in rtsp.split('://', 1)[1].split('/')[0]:
        return _esc_userinfo(rtsp), 'nguyen ban'   # box da co credential, chi escape
    host = rtsp.split('://', 1)[1].split('/')[0].split(':')[0]
    ui = creds.get(host) or creds.get(ch.get('ip') or '')
    src = 'go2rtc.yaml'
    if not ui:
        return rtsp, 'thieu mat khau'
    user, _, pw = ui.partition(':')
    esc = lambda s: re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', s)
    return rtsp.replace('rtsp://', f'rtsp://{esc(user)}:{esc(pw)}@', 1), src


def _orphans(names, chans, cap):
    """Box la source of truth: moi luong go2rtc khong co channel tuong ung tren box
    la ruong -> dong bo thi xoa het. Nguoi dung them camera bang cach tao channel
    (app.js: POST /api/channel/add roi dat ten ch<channel_id>), nen luong ten khac
    chi con la do _probe/thu tay de lai. Tru duong dang bat dau bang '_': testUrl
    tao `_probe_<ms>` song thoang qua, xoa giua chung se lam bai test hong.
    cap = pagesize cua /channel/list: tra dung cap nghia la danh sach co the bi cat,
    xoa luc do la xoa oan camera dang chay -> tra rong."""
    if len(chans) >= cap:
        return []
    live = {f'ch{c.get("channel_id")}' for c in chans}
    return sorted(n for n in names if not n.startswith('_') and n not in live)


def sync_streams(prune=True):
    """/channel/list -> them stream vao go2rtc. Ten stream = ch<channel_id> nen
    UI ghep channel_id <-> stream khong can map tay. prune=True (nut "Dong bo
    camera") con xoa luong mo coi cua channel da bi bo tren box -> 2 chieu."""
    pagesize = 100
    r = box.call('/api/v2/channel/list', {'page': 1, 'pagesize': pagesize})
    if r.get('code') != 0:
        return r
    _, cur = go2rtc('GET', '/api/streams')
    streams = json.loads(cur or b'{}')
    creds = _creds_from_go2rtc(streams)

    added, kept, noauth, removed = [], [], [], []
    # doc dung ca 'channel_list' (theo tai lieu) va 'list' (mot so firmware)
    chans = r.get('data', {}).get('channel_list') or r.get('data', {}).get('list') or []
    for ch in chans:
        name, raw = f'ch{ch.get("channel_id")}', ch.get('rtsp') or ''
        if not raw:
            continue
        if name in streams:
            kept.append(name)
            continue
        src, how = _with_creds(raw, ch, creds)
        if how == 'thieu mat khau':
            # Van them: co the camera khong doi auth, hoac nguoi dung se sua sau.
            noauth.append({'name': name, 'ip': ch.get('ip'), 'rtsp': raw})
        go2rtc('PUT', '/api/streams?' + urlencode({'name': name, 'src': src}))
        added.append(name)
    # Chieu nguoc lai: channel da xoa tren box -> luong ch<id> cu phai bien mat,
    # neu khong no treo mai trong grid nhu mot camera chet. Box tra ve 0 channel
    # (dang khoi dong / mat mang thoang) thi dung xoa: thau het ca bang.
    if prune and chans:
        for nm in _orphans(streams, chans, pagesize):
            st, _ = go2rtc('DELETE', '/api/streams?' + urlencode({'src': nm}))
            if st < 300:
                removed.append(nm)
    return {'code': 0, 'added': added, 'kept': kept, 'removed': removed,
            'noauth': noauth,
            'channels': [{'channel_id': c.get('channel_id'), 'name': c.get('channel_name'),
                          'ip': c.get('ip'), 'status': c.get('status'),
                          'model': c.get('model')} for c in chans]}


# -------------------------------------------------------------- alarm receiver
_subs, _subs_lock = [], threading.Lock()
_video_buf = {}
_vid_cache = {}          # query -> bytes clip da tai, de phuc vu Range                                    # video_uuid -> bytes cho toi khi co alarm

TYPES = {1: 'behavior', 2: 'reset', 3: 'face', 4: 'facematch',
         5: 'behavior+match', 6: 'keepalive', 7: 'channel'}

# Ten hien thi tieng Viet cho tung algo_model (dong bo voi ALGO_VI trong ui/ai.js).
# Box chi gui ma ky thuat (LineDetectorCrossed...) -> phai dich sang ten hanh vi de
# nguoi xem Telegram hieu ngay. Ma la -> giu nguyen (khong bao gio tra rong).
ALGO_VI = {
    'SafetyHelmetAlarm': 'Không mũ bảo hộ', 'WorkClothesAlarm': 'Không đồng phục',
    'TelephoningAlarm': 'Gọi điện thoại', 'SmokingAlarm': 'Hút thuốc',
    'SleepingDetectionAlarm': 'Ngủ khi làm việc', 'OffDutyDetectionAlarm': 'Vắng mặt',
    'ChannelBlockageDetection': 'Chắn lối thoát hiểm', 'ObjectRemoved': 'Vật để lại',
    'FieldDetectorObjectsInside': 'Xâm nhập vùng', 'AccessElevatorAlarm': 'Xe điện vào thang máy',
    'NoMaskAlarm': 'Không khẩu trang', 'FallOverAlarm': 'Té ngã',
    'CrowdDensityCriticalAlarm': 'Quá đông người', 'ReflectiveClothesDetectionAlarm': 'Không áo phản quang',
    'AbnormalParkingDetection': 'Đỗ xe sai / chắn lối chữa cháy',
    'AbnormalParkingDetection_HighSpeedEvent': 'Đỗ xe bất thường (giao thông)',
    'FumesAlarmBegin': 'Khói', 'PlayMobilePhoneDetection': 'Dùng điện thoại',
    'FireDetection': 'Cháy', 'LongStayDetection': 'Ở lại quá lâu',
    'FightDetectionAlarm': 'Đánh nhau', 'LineDetectorCrossed': 'Vượt vạch',
    'EnterArea': 'Vào vùng', 'LeaveArea': 'Ra khỏi vùng',
    'AreaRuleData': 'Đếm người trong vùng', 'LineRuleData': 'Đếm người qua vạch',
    'ObjectIsRecognized': 'Nhận diện mặt', 'NonMotorAbnormalParkingDetection': 'Xe 2 bánh đỗ sai',
    'UncoveredTrashCanDetection': 'Thùng rác mở nắp', 'MouseDetect': 'Chuột',
    'BareSoilCoverDetection': 'Đất trống chưa phủ', 'DisorderStackingDetection': 'Xếp vật liệu sai',
    'TrashOverflowingDetection': 'Thùng rác tràn', 'ExposedGarbageDetection': 'Rác lộ thiên',
    'PackedGarbageDetection': 'Rác đóng túi', 'ShirtlessDetection': 'Không mặc áo',
    'ChefHatAlarm': 'Không mũ đầu bếp', 'ChefClothesDetection': 'Không đồng phục đầu bếp',
    'SafetyHarnessDetection': 'Không dây an toàn', 'ClimbingDetectionAlarm': 'Trèo leo',
    'PeopleGathering': 'Tụ tập', 'FastMoving': 'Di chuyển nhanh',
    'StayAloneDetection': 'Thiếu người trực', 'KnifeStickDetection': 'Cầm dao / gậy',
    'UnwashedVehicleDetection': 'Xe chưa rửa', 'VehicleOverspeedDetection': 'Xe quá tốc độ',
    'ForkliftOverspeedDetection': 'Xe nâng quá tốc độ', 'NoSafetyBeltDetection': 'Không thắt dây an toàn',
    'PresetMarkerDetection': 'Mốc định sẵn', 'GasCylinderDetection': 'Bình gas',
    'ChargingGunNotinPlace': 'Súng sạc không đúng chỗ', 'NoFireExtinguisherDetection': 'Thiếu bình chữa cháy',
    'DumpTruckWithoutTarp': 'Xe ben không phủ bạt', 'OilLeakDetection': 'Rò dầu',
    'GasLeakDetection': 'Rò khí', 'LiquidLeakDetection': 'Rò nước',
    'TestPaperColorChangeDetection': 'Giấy thử đổi màu', 'NoSafetyGogglesDetection': 'Không kính bảo hộ',
    'NoSafetyGlovesDetection': 'Không găng tay', 'NoDustGasMaskDetection': 'Không mặt nạ phòng độc',
    'ExposedLongHairDetection': 'Tóc dài không buộc', 'CampusEntranceExitLPC': 'Biển số ra vào khu',
    'CampusVehicleCongestionDetection': 'Ùn xe trong khu', 'DogDetection': 'Chó',
    'FuelUnloadDetect': 'Xả dầu', 'Construction': 'Thi công đường',
    'ThrowingEvent': 'Ném rác', 'TrafficAccident': 'Tai nạn giao thông',
    'DriveSlowly': 'Xe chạy quá chậm', 'DriveAway': 'Xe rời đi',
    'Fogging': 'Sương mù', 'NonMotorVehicleIntrusionDetection': 'Xe 2 bánh xâm nhập',
    'OccupancyEmergencyLane': 'Chiếm làn khẩn cấp', 'Pedestrian': 'Người đi bộ xâm nhập',
    'Retrograde': 'Xe đi ngược chiều', 'SnowCover': 'Tuyết phủ mặt đường',
    'Congestion': 'Ùn tắc', 'VehicleEnterExitServiceStation': 'Xe ra vào trạm',
    'ForkliftDetection': 'Xe nâng', 'EngineeringVehicleDetection': 'Xe công trình',
    'IllegalAdditionOfBulkGasoline': 'Bơm xăng trái phép', 'WildlifeIntrusionDetection': 'Động vật xâm nhập',
    'FireOperationUnattended': 'Hàn cắt không người trông', 'SmokeAndFireDetectionEvent': 'Khói và lửa',
    'RestrictedAreaFishingDetection': 'Đánh bắt khu cấm', 'WaterOutletDischargeDetection': 'Xả thải cửa nước',
    'HandDetection': 'Bàn tay', 'FreightInPassengerElevator': 'Chở hàng trong thang khách',
    'ElectricBicycleIntrusionDetection': 'Chở hàng trong thang khách', 'LongQueueDetection': 'Xếp hàng dài',
    'LightsLeftOnDetection': 'Quên tắt đèn', 'PedestrianAntiDirectionDetection': 'Người đi ngược chiều',
    'ReverseMotionOnEscalator': 'Đi ngược thang cuốn', 'GunmanDetection': 'Súng',
    'ShipDetection': 'Tàu thuyền', 'SurfaceWaterDetection': 'Ngập nước mặt đường',
    'TrafficParameters': 'Thông số giao thông', 'TrafficParameter': 'Thông số giao thông',
}


def _algo_vi(ev):
    """Ten hanh vi tieng Viet cua alarm. Uu tien algo_model (dich qua ALGO_VI),
    roi label (type 1=behavior), cuoi cung ma thay."""
    m = ev.get('algo_model')
    if m:
        return ALGO_VI.get(m) or m
    return ev.get('label') or str(ev.get('type') or 'Canh bao')


def _publish(ev):
    line = f'data: {json.dumps(ev, ensure_ascii=False)}\n\n'.encode()
    with _subs_lock:
        for q in _subs:
            # Queue day = client doc cham hon box day (AreaRuleData ~1 dong/giay,
            # 200 slot chi vai phut la tran). TRUOC DAY huy dang ky luon: vong _sse
            # van chay va van gui ': ping' moi 20s nen EventSource khong he biet la
            # bi ngat -> khong reconnect -> tab Nhat ky DUNG YEN VINH VIEN va tuong
            # nhu "cham hon aibox". Vut tin CU, giu dang ky: thieu vai AreaRuleData
            # khong sao (badge chi can so cuoi cung), mat ket noi moi la chet.
            while q.full():
                try:
                    q.get_nowait()
                except queue.Empty:
                    break
            try:
                q.put_nowait(line)
            except queue.Full:
                pass
    # Day ra ngoai (Telegram...) KHONG duoc chan HTTP handler cua box -> thread rieng.
    if CONN.get('tg_token') and CONN.get('tg_chats'):
        threading.Thread(target=_tg_forward, args=(ev,), daemon=True).start()


# ------------------------------------------------------------------ telegram
# Registry ben vung: chat_id -> {id,title,type} moi nhom bot TUNG thay (qua
# getUpdates). Telegram KHONG co API "list groups cua bot" -> phai tu nho lay.
_TG_SEEN = os.path.join(DATA, 'tg_groups.json')
# Nguon clip cua tung alarm da gui, de /video <id> keo lai duoc. Append-only (chi
# ghi them, khong sua) -> khong can lock. Xem _tg_log_tail.
_TG_ALARM_LOG = os.path.join(DATA, 'tg_alarms.jsonl')
_TG_SEQ = 0                      # so thu tu alarm, noi tiep tu dong cuoi log
# Lock chung cho MỌI getUpdates (poll + discover). Telegram chi cho 1 getUpdates
# dong thoi moi token — 2 request song song -> 409 Conflict. Poll long-poll giu
# lock lau, discover chien lock ngan; ai toi truoc thi duoc goi.
_TG_UPD_LOCK = threading.Lock()
# Nghi giua 2 lan getUpdates. Telegram van tinh phien long-poll TRUOC la dang chay
# vai giay sau khi no tra ve, nen ban lien tuc = 409 xen ke thanh cong (do that tren
# token nay: nghi 1s -> 2/4 lan 409; nghi 4s -> 4/4 ok). Khong nghi thi bot chi poll
# duoc ~18s/lan (8s long-poll + 409 + ngu 10s) -> lenh /setup, /video tre toi 20s.
_TG_POLL_GAP = 4


def _tg_load_seen():
    try:
        with open(_TG_SEEN, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _tg_save_seen(seen):
    try:
        with open(_TG_SEEN, 'w', encoding='utf-8') as f:
            json.dump(seen, f, ensure_ascii=False, indent=1)
    except OSError:
        pass


# So nguoi trong vung moi nhat theo camera: {channel_id: {'count': n, 'name': ten, 'ts': time}}.
# Cap nhat moi khi box day AreaRuleData (dem nguoi real-time, ~1 dong/giay). Bot dung
# de tra loi /countpeople.
_AREA = {}

# ---- chong "lay lai hang cu" sau khi BE mat ket noi voi box ------------------
# Khi link box<->BE dut, box TAM GIU alarm trong bo nho roi khi noi lai se day lai
# CA HANG CU trong vai giay (bang chung: 09-14 08:25:12 co ~84 alarm capture_time
# 08:18-08:20 day trong 4s). BE chi nen nhan alarm moi nhat, bo hang cu.
# Cach danh gia "cu": box KHONG dong ho voi PC (tre ~300-1500s, troi) nen khong dung
# moc cung dinh. Tu hoc: _BOX_LAG = tre trung binh (luc nhan - capture_time) cua cac
# alarm BINH THUONG. Chi khi PHA'T HIEN dut noi (im lang > _BOX_GAP) moi ap luat: loai
# alarm nao tre hon _BOX_LAG + _BOX_SLACK (la hang cu), giu cai moi nhat.
_BOX_LOCK = threading.Lock()
_BOX_GAP = 90          # giay im lang -> tinh la tung mat ket noi
_BOX_SLACK = 300       # du qua muc binh thuong bao nhieu giay thi tinh la hang cu
_BOX_LAG = None        # tre trung binh (EWMA), tu hoc tu cac alarm nhan
_BOX_AT = 0.0          # lan cuoi nhan duoc alarm (dong ho PC)
_BOX_RELINK = 0.0      # dang trong cua so "noi lai" (dang xa hang cu)
_BOX_DROP = 0          # dem alarm da bo de in log 1 lan


def _box_lag_gate(ct):
    """Nhan alarm co capture_time=ct (epoch). Tra True = nen GIU (moi), False = nhan
    duoc alarm cu sau khi vua mat ket noi -> bo. Goi truoc khi luu/jsonl/publish."""
    global _BOX_LAG, _BOX_AT, _BOX_RELINK, _BOX_DROP
    now = time.time()
    with _BOX_LOCK:
        gap = now - _BOX_AT            # kiem TRA TRUOC khi cap nhat _BOX_AT
        _BOX_AT = now
        lag = now - ct
        # Dang trong cua so xa hang cu (vua noi lai / con alarm cu dang toi)?
        relink = (now - _BOX_RELINK < _BOX_GAP + 30)
        if gap > _BOX_GAP and not relink:
            _BOX_RELINK = now          # im lang qua _BOX_GAP -> vua noi lai
            relink = True
        if relink and _BOX_LAG is not None:
            # Dang xa hang cu: chi giu alarm co tre gan muc binh thuong (cai moi nhat),
            # bo phan cu hon. Moi lan bo lai keo dai cua so cho het luot day.
            if lag > _BOX_LAG + _BOX_SLACK:
                _BOX_RELINK = now
                _BOX_DROP += 1
                return False
        # Alarm moi/chanh thuong: hoc tre binh thuong. EWMA nhanh de theo sau do tre
        # troi, bo qua jitter tung alarm.
        if lag >= 0:
            _BOX_LAG = lag if _BOX_LAG is None else (0.6 * _BOX_LAG + 0.4 * lag)
        return True


def _area_last(channel_id):
    """So dem nguoi CUOI CUNG da tung nhan cho 1 camera (du push da dung). _AREA chi
    giu trong RAM (mat khi restart); khi camera khong co trong _AREA (chua push trong
    phien nay / may moi khoi dong), quet alarms.jsonl tu moi nhat tim AreaRuleData
    cuoi cho channel do. Tra (count, name) hoac (None, None) neu chua bao gio co.
    quet tu CUOI file (khong doc ca file — jsonl co the rat lon)."""
    fn = os.path.join(ALARM_DIR, 'alarms.jsonl')
    if not os.path.exists(fn):
        return None, None
    size = os.path.getsize(fn)
    CHUNK = 1 << 20                       # doc 1MB moi lan tu cuoi lui dan
    try:
        pos = size
        buf = b''
        while pos > 0:
            take = min(CHUNK, pos)
            pos -= take
            with open(fn, 'rb') as f:
                f.seek(pos)
                chunk = f.read(take)
            buf = chunk + buf
            # chi xu ly dong hoan chinh tinh tu cuoi buf
            lines = buf.split(b'\n')
            buf = lines[0]                # phan dau do cua block (co the le)
            for ln in reversed(lines[1:]):
                if not ln.strip():
                    continue
                try:
                    a = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                ob = a.get('behaviour') or a.get('face') or {}
                if ob.get('algo_model') != 'AreaRuleData' or ob.get('area_num') is None:
                    continue
                ci = a.get('channel_info') or {}
                cid = ci.get('channel_id', a.get('channel_id'))
                if str(cid) == str(channel_id):
                    name = ci.get('channel_name') or a.get('channel_name') or ('CH' + str(cid))
                    return ob.get('area_num'), name
            if pos == 0:                  # da quet het file
                break
    except OSError:
        pass
    return None, None


def _box_channels():
    """Danh sach CAMERA co tren box qua /channel/list. Tra [(channel_id, channel_name)].
    Khi khong doc duoc (chua co IP/pass/box loi) -> [] de bot chi in camera co du lieu."""
    if not CONN['host'] or not CONN['pass']:
        return []
    try:
        r = box.call('/api/v2/channel/list', {'page': 1, 'pagesize': 100})
        if r.get('code') != 0:
            return []
        chans = r.get('data', {}).get('channel_list') or r.get('data', {}).get('list') or []
        return [(c.get('channel_id'), c.get('channel_name') or ('CH' + str(c.get('channel_id'))))
                for c in chans if c.get('channel_id') is not None]
    except Exception:
        return []


def _box_area_enabled():
    """HOI box truc tiep: camera nao dang bat thuật toán dem nguoi trong vung
    (AreaRuleData). GET /api/v2/smart/enable/list -> [{channel_id, algo_model:[...]}].
    Tra set(channel_id) co AreaRuleData. Khong doc duoc -> tra None (bot se khong
    loc, hien tat ca camera co du lieu)."""
    if not CONN['host'] or not CONN['pass']:
        return None
    try:
        r = box.call('/api/v2/smart/enable/list', {})
        if r.get('code') != 0:
            return None
        out = set()
        for c in r.get('data') or []:
            algos = c.get('algo_model') or []
            if any(str(a) == 'AreaRuleData' for a in algos):
                out.add(str(c.get('channel_id')))
        return out or None          # None khi khong co camera nao bat dem
    except Exception:
        return None


def _tg_discover():
    """getUpdates -> gom moi chat bot thay vao registry. KHONG gui offset nen
    update van con cho lan doc sau (Telegram giu ~24h; registry giu lau hon)."""
    tok = CONN.get('tg_token')
    if not tok:
        return [], 'Chua dien bot token'
    seen = _tg_load_seen()
    try:
        # Lock tranh 409 voi poll long-poll. Neu poll dang giu (>12s), bo qua
        # getUpdates de khong treo HTTP handler — registry da co du lieu gui ve.
        if not _TG_UPD_LOCK.acquire(timeout=12):
            return list(seen.values()), None
        try:
            r = json.loads(urlopen(
                Request(f'https://api.telegram.org/bot{tok}/getUpdates'), timeout=15).read() or b'{}')
        finally:
            _TG_UPD_LOCK.release()
        if not r.get('ok'):
            return list(seen.values()), r.get('description', 'getUpdates loi')
        for upd in r.get('result') or []:
            _tg_collect(seen, upd)
    except Exception as e:
        print('[tg] discover that bai:', e)
        return list(seen.values()), str(e)
    _tg_save_seen(seen)
    return list(seen.values()), None


def _tg_chat_info(cid):
    """getChat -> (ten that, id chuan). Dung de nhap Chat ID thủ công: getUpdates
    khong bao gio thay nhom "im lang" (khong ai nhan 24h), nen ID tay la con duong
    DUY NHAT them duoc nhom do. getChat tra ten de nguoi dung xac nhan dung nhom,
    VA id chuan (canonical): supergroup thuong phai dung dang -100... (id "xem duoc"
    trong URL co the la id cu, gui vao se HTTP 400 Bad Request). Tra id chuan ve
    de UI luu id chuan thay vi giu id nguoi dung go."""
    tok = CONN.get('tg_token')
    if not tok:
        return '', '', 'Chua dien bot token'
    try:
        r = json.loads(urlopen(
            Request(f'https://api.telegram.org/bot{tok}/getChat?chat_id={cid}'), timeout=15).read() or b'{}')
        if not r.get('ok'):
            return '', '', r.get('description', 'getChat loi')
        ch = r.get('result') or {}
        name = ch.get('title') or ch.get('username') or ch.get('first_name') or cid
        cid_canon = ch.get('id') or cid
        return name, str(cid_canon), None
    except Exception as e:
        return '', '', str(e)


def _tg_countpeople(args, chat):
    """Tra loi /countpeople. HOI box truc tiep: /api/v2/smart/enable/list -> camera nao
    bat thuật toán dem nguoi (AreaRuleData). args: 'ch1,ch2' = nguoi tung camera do;
    '' = cac camera CO BAT dem nguoi tren box; 'sum' = tong nguoi cac camera do.
    So nguoi lay tu _AREA (box chi PUSH AreaRuleData real-time, khong co API query
    so hien tai — so moi nhat tu push ~1 giay/lan la gan nhat). Gui ve chat goi lenh."""
    area = _AREA
    enabled = _box_area_enabled()       # set(channel_id) co AreaRuleData, None neu loi
    by_name = {str(cid): name for cid, name in _box_channels()}

    def _val(cid):
        """(count, name) cho 1 camera: uu tien _AREA (moi nhat trong phien), roi lich su."""
        x = area.get(cid)
        if x and x.get('count') is not None:
            return x.get('count'), by_name.get(cid) or x.get('name') or ('CH' + cid)
        n, nm = _area_last(cid)          # so cuoi cung da tung nhan (du push dung)
        if n is not None:
            return n, by_name.get(cid) or nm or ('CH' + cid)
        return None, by_name.get(cid) or ('CH' + cid)

    a = args.strip().lower()
    lines = []
    # List camera ap dung: nhung cai co bat dem nguoi (hoac tat ca neu khong doc duoc)
    area_ids = sorted(enabled) if enabled is not None else sorted(area, key=lambda k: int(k))
    if a == 'sum':
        if not area_ids:
            _tg_post('sendMessage', chat, {'text': 'Không có camera nào bật đếm người trong vùng trên box.'})
            return True, None
        total = sum(_val(cid)[0] or 0 for cid in area_ids)
        lines.append(f'👥 Tổng người ở {len(area_ids)} camera (có bật đếm người): {total}')
    elif a == '':
        if not area_ids:
            _tg_post('sendMessage', chat, {'text': 'Không có camera nào bật đếm người trong vùng trên box.'})
            return True, None
        lines.append(f'👥 Số người ({len(area_ids)} camera có bật đếm người):')
        for cid in area_ids:
            n, name = _val(cid)
            lines.append(f'📹 {name} (CH{cid}): {n if n is not None else "chưa có dữ liệu đếm"} người')
    else:
        # loc tung ch1,ch2...
        want = [str(c).replace('ch', '').replace('CH', '').strip() for c in
                re.split(r'[,\s]+', a) if c]
        lines.append('👥 Số người theo camera:')
        for w in want:
            name = by_name.get(w)
            if name is None:
                lines.append(f'📹 CH{w}: không có camera này trên box')
                continue
            n, nm = _val(w)
            lines.append(f'📹 {nm} (CH{w}): {n if n is not None else "chưa có dữ liệu đếm"} người')
    _tg_post('sendMessage', chat, {'text': '\n'.join(lines)})
    return True, None


def _tg_setup(args, chat):
    """Cau hinh cho CHINH nhom go lenh. Chua /setup = nhom do khong nhan alarm nao,
    du da tick o tab Cau hinh tren web. Luu vao aibox.conf.json."""
    a = args.strip()
    setups = CONN.setdefault('tg_setup', {})
    cur = setups.get(str(chat)) or {}
    low = a.lower()
    if not a:
        if cur.get('mode') == 'all':
            st = 'gui TAT CA alarm'
        elif cur.get('mode') == 'rule':
            st = f"setup '{cur.get('name')}' — chua gui alarm nao"
        else:
            st = 'CHUA setup — khong nhan alarm nao'
        _tg_post('sendMessage', chat, {'text': (
            f'⚙️ Nhóm này: {st}\n\n'
            '/setup all — gửi tất cả alarm\n'
            '/setup off — tắt, không nhận gì\n'
            '/setup <tên> — tạo setup rỗng (vd /setup c27)\n'
            '/video <id> — gửi lại clip của alarm #id')})
        return True, None
    if low in ('off', 'tat', 'tắt'):
        setups.pop(str(chat), None)
        save_conf()
        _tg_post('sendMessage', chat, {'text': '🔕 Đã tắt — nhóm này không nhận alarm nào.'})
        return True, None
    if low == 'all':
        setups[str(chat)] = {'mode': 'all', 'name': 'all', 'algos': []}
        msg = '🔔 Đã bật — nhóm này nhận TẤT CẢ alarm.'
    else:
        setups[str(chat)] = {'mode': 'rule', 'name': a, 'algos': []}
        msg = (f"⚙️ Đã tạo setup '{a}' cho nhóm này.\n"
               'Hiện chưa gửi alarm nào.')
    save_conf()
    _tg_post('sendMessage', chat, {'text': msg})
    return True, None


def _tg_send_video(args, chat):
    """Tra loi /video <id>: gui lai clip cua alarm do. Uu tien file box day ve (neu
    co), khong thi KEO lai tu video_url. Box chi giu clip mot khoang thoi gian nen
    het han thi bao thang, khong gui nham clip rong."""
    aid = args.strip().lstrip('#')
    if not aid:
        _tg_post('sendMessage', chat, {'text':
                 'Dùng: /video <id> — id nằm ở dòng 🆔 của tin alarm.'})
        return True, None
    rec = next((r for r in _tg_log_tail() if str(r.get('id')) == aid), None)
    if not rec:
        _tg_post('sendMessage', chat, {'text': f'Không tìm thấy alarm #{aid}.'})
        return True, None
    f = _tg_video(rec.get('file') or '') or _tg_video_url(rec)
    if not f:
        print(f'[tg] /video #{aid}: box khong tra clip')
        _tg_post('sendMessage', chat, {'text': f'Clip của alarm #{aid} đã hết hạn trên box.'})
        return True, None
    print(f'[tg] /video #{aid}: gui clip {len(f[1])} bytes')
    _tg_post('sendVideo', chat, {'caption': rec.get('cap') or f'Alarm #{aid}'}, {'video': f})
    return True, None


def _tg_handle_command(text, chat):
    """Xu ly lenh tu Telegram: bat dau bang '/'. /countpeople, /setup, /video."""
    body = text.strip()
    if not body.startswith('/'):
        return False
    cmd, _, rest = body.partition(' ')
    cmd = cmd.lower()
    if cmd in ('/countpeople', '/count_people', '/count'):
        _tg_countpeople(rest, chat)
        return True
    if cmd == '/setup':
        _tg_setup(rest, chat)
        return True
    if cmd == '/video':
        _tg_send_video(rest, chat)
        return True
    return False


def _tg_collect(seen, upd):
    """Gop chat tu 1 update vao registry. Dung chung cho discover (khong confirm)
    va poll (co confirm) — de nhom moi them khong bi poll confirm lam mat."""
    chat = None
    for key in ('message', 'edited_message', 'channel_post', 'edited_channel_post'):
        if isinstance(upd.get(key), dict):
            chat = upd[key].get('chat'); break
    if not chat and isinstance(upd.get('callback_query'), dict):
        chat = (upd['callback_query'].get('message') or {}).get('chat')
    for key in ('my_chat_member', 'chat_member'):
        if not chat and isinstance(upd.get(key), dict):
            chat = upd[key].get('chat')
    if chat and chat.get('id') is not None:
        cid = str(chat['id'])
        seen[cid] = {'id': cid,
                     'title': chat.get('title') or chat.get('username')
                              or chat.get('first_name') or cid,
                     'type': chat.get('type', '')}


def _tg_poll():
    """Vong lap getUpdates lang nghe lenh tu nhom. Khi gap /countpeople thi tra loi
    ngay trong chat do. Dung offset de confirm update da xu ly -> khong lap lenh.
    Vua gop chat vao registry (dung chung _tg_collect) de nhom moi khong bi mat.
    Dung _TG_UPD_LOCK de khong 409 voi discover. That bai thi ngu 10s roi thu lai.
    Moi vong thanh cong nghi _TG_POLL_GAP giay — xem comment o _TG_POLL_GAP."""
    offset = 0
    while True:
        tok = CONN.get('tg_token')
        if not tok:
            time.sleep(3); continue
        try:
            with _TG_UPD_LOCK:                       # tranh 409 voi discover
                q = f'https://api.telegram.org/bot{tok}/getUpdates?timeout=8&offset={offset}'
                r = json.loads(urlopen(Request(q), timeout=15).read() or b'{}')
            if not r.get('ok'):
                time.sleep(10); continue
            seen = _tg_load_seen()
            changed = False
            for upd in r.get('result') or []:
                uid = upd.get('update_id', 0)
                if uid < offset:
                    continue
                offset = uid + 1                 # confirm update nay (khong lay lai)
                before = len(seen)
                _tg_collect(seen, upd)
                if len(seen) != before:
                    changed = True
                msg = upd.get('message') or {}
                chat = (msg.get('chat') or {}).get('id')
                if chat is not None:
                    _tg_handle_command(msg.get('text') or '', str(chat))
            if changed:
                _tg_save_seen(seen)
            time.sleep(_TG_POLL_GAP)     # khong nghi -> lan ke tiep chac chan 409
        except Exception as e:
            print('[tg] poll loi:', e)
            time.sleep(10)


def _tg_post(method, chat, fields=None, files=None, _retry=0):
    """multipart/form-data -> Telegram Bot API, gui toi 1 chat. Stdlib only.
    Tra ve (ok: bool, err: str|None). _retry = so lan da thu lai sau khi bi 429."""
    tok = CONN.get('tg_token')
    if not tok or not chat:
        return False, 'Chua dien bot token + chat id'
    bnd = '----aibox' + secrets.token_hex(8)
    buf = io.BytesIO()
    fields = dict(fields or {})
    fields['chat_id'] = chat
    for k, v in fields.items():
        buf.write(f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (fn, data, ctype) in (files or {}).items():
        buf.write((f'--{bnd}\r\nContent-Disposition: form-data; name="{k}"; '
                   f'filename="{fn}"\r\nContent-Type: {ctype}\r\n\r\n').encode())
        buf.write(data)
        buf.write(b'\r\n')
    buf.write(f'--{bnd}--\r\n'.encode())
    req = Request(f'https://api.telegram.org/bot{tok}/{method}', data=buf.getvalue(),
                  headers={'Content-Type': f'multipart/form-data; boundary={bnd}'})
    try:
        resp = json.loads(urlopen(req, timeout=30).read() or b'{}')
        if resp.get('ok'):
            return True, None
        d = resp.get('description') or 'Telegram tra ve ok=false'
        print('[tg]', method, 'that bai:', d)
        return False, d
    except HTTPError as e:                       # Telegram tra HTTP 4xx/5xx (vd 400)
        # Body chua description chinh xac ("chat not found", "bot was blocked"...)
        # — khong in chung chung "HTTP Error 400: Bad Request" ma mat goc benh.
        body = {}
        try:
            body = json.loads(e.read().decode('utf-8', 'replace') or b'{}')
        except Exception:
            body = {}
        # 429 = gui qua tay (Telegram gioi han ~20 tin/nhom/phut, ma box day alarm
        # lien tuc). retry_after noi ro doi bao lau; KHONG doi thi anh/clip mat han
        # — /video lay duoc clip 5MB tu box xong van khong gui duoc vi ly do nay.
        # Chi thu lai 1 lan: alarm tran ngap ma doi mai thi treo het thread.
        if body.get('error_code') == 429 and _retry < 1:
            wait = min(int((body.get('parameters') or {}).get('retry_after') or 3), 30)
            print(f'[tg] {method} bi gioi han toc do -> doi {wait}s gui lai')
            time.sleep(wait)
            return _tg_post(method, chat, fields, files, _retry + 1)
        d = body.get('description') or ''
        err = d or str(e)
        print('[tg]', method, 'that bai:', err)
        return False, err
    except Exception as e:                       # loi TG khong duoc lam chet bridge
        print('[tg]', method, 'that bai:', e)
        return False, str(e)


def _tg_targets(ev=None, rule_send=False):
    """Nhom DUOC gui alarm nay: phai /setup trong CHINH nhom do. 'all' = gui het;
    'rule' = che do c27, chi gui khi rule_send (ket qua _c27_decide, tinh 1 lan
    cho ca event vi no co side effect ghi lich su).
    MOT cho duy nhat dinh nghia luat nay — _tg_forward va _tg_send_all deu goi day."""
    out = []
    for c in CONN.get('tg_chats') or []:
        m = ((CONN.get('tg_setup') or {}).get(str(c)) or {}).get('mode')
        if m == 'all' or (m == 'rule' and ev is not None and rule_send):
            out.append(c)
    return out


def _tg_send_all(method, fields=None, files=None, chats=None):
    """Gui 1 media/text den cac nhom da /setup. chats=None -> tu loc theo tg_chats
    (khong co ev nen chi nhom mode 'all' lot qua)."""
    if not CONN.get('tg_token'):
        return
    for c in (_tg_targets() if chats is None else chats):
        _tg_post(method, c, fields, files)


def _tg_caption(ev, aid=None, title=None):
    ts = ev.get('ts')
    when = time.strftime('%H:%M:%S %d/%m/%Y', time.localtime(ts)) if ts else ''
    # Dong dau: 🚨 + ten hanh vi tieng Viet (dich tu algo_model). Ghi ro "behavior".
    # title = chu de do che do c27 dat lai ('Sai đồng phục', '<ten> đã đi muộn'...).
    parts = [f"\U0001f6a8 {title or _algo_vi(ev)}"]
    # Chi tiet doi tuong phat hien: capture_info moi phan tu = 1 doi tuong. Alarm
    # nhan dien mat (type 4/5) KHONG co capture_info -> dem theo compare_results.
    person = ev.get('person') or {}
    n_obj = len(ev.get('capture_info') or []) or (1 if person else 0)
    if n_obj:
        who = str(person.get('name') or '').strip()
        sim = person.get('similarity')
        if who and sim is not None:
            who = f'{who} {sim}%'
        # Khong co ten -> noi ro "khong nhan dien duoc", dung de trong gay hieu nham.
        parts.append(f"\U0001f465 {n_obj} doi tuong phat hien - "
                     f"{who or 'khong nhan dien duoc'}")
    if ev.get('channel_name'):
        parts.append(f"\U0001f4f7 Camera {ev['channel_name']}")
    if ev.get('ipc_addr'):
        parts.append(f"IP {ev['ipc_addr']}")
    if ev.get('area_num'):
        parts.append(f"\U0001f465 {ev['area_num']} nguoi trong vung")
    if when:
        parts.append(f"\U0001f552 {when}")
    if aid is not None:
        parts.append(f"\U0001f194 #{aid}")           # /video <id> de gui lai clip
    return '\n'.join(parts)


def _tg_image(ev):
    """Anh dau tien cua alarm -> (ten, bytes, ctype). base64 da luu dia, hoac URL
    /aibox/picture? (anh nam tren box) -> GET nguoc bang digest."""
    for im in ev.get('images') or []:
        try:
            if im.startswith('/aibox/picture'):
                st, data = box.raw('GET', '/api/v2/smart/picture?' + im.split('?', 1)[-1])
                if st == 200 and data:
                    return ('alarm.jpg', data, 'image/jpeg')
            else:
                p = os.path.join(ALARM_DIR, im)
                if os.path.isfile(p):
                    with open(p, 'rb') as f:
                        return (im, f.read(), 'image/jpeg')
        except Exception as e:
            print('[tg] anh that bai:', e)
    return None


def _tg_video(fn):
    p = os.path.join(ALARM_DIR, fn)
    if os.path.isfile(p):
        with open(p, 'rb') as f:
            return (fn, f.read(), 'video/mp4')
    return None


def _tg_video_url(ev):
    """Kéo clip từ box qua video_url (dang /aibox/video?ChlId=..&StartTime=..&EndTime=..).
    Box KHONG push file video — chi cung cap video_url de KEO ve (clip cat theo khoang
    thoi gian, ~1.4MB). Dung digest auth nhu _tg_image. Tra (ten, bytes, ctype) hoac None."""
    u = ev.get('video_url') or ev.get('url')   # log alarm ghi key 'url'
    if not u:
        return None
    q = u.split('?', 1)[-1] if '?' in u else ''
    if not q:
        return None
    try:
        st, data = box.raw('GET', '/api/v2/smart/video?' + q)
        # Clip < 1KB la rong (box khong con giu video cho khoang thoi gian cu) —
        # gui len Telegram chi ra video den/loi. Coi nhu khong co video, de loi
        # cho anh phat hien.
        if st == 200 and data and len(data) >= 1024:
            return ('alarm.mp4', data, 'video/mp4')
        print('[tg] video_url tra', st, len(data or b''), 'bytes')
    except Exception as e:
        print('[tg] video that bai:', e)
    return None


def _tg_log_tail(nbytes=262144):
    """Cac dong cuoi cua _TG_ALARM_LOG, moi nhat truoc. Chi doc duoi file: id can tim
    va clip cua no luon nam trong nhom alarm moi nhat (alarm cu thi box cung het giu
    clip). Dong dau bi cat lam -> json loi -> bo qua."""
    try:
        with open(_TG_ALARM_LOG, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - nbytes))
            buf = f.read()
    except OSError:
        return []
    out = []
    for ln in buf.split(b'\n'):
        if ln.strip():
            try:
                out.append(json.loads(ln))
            except (ValueError, UnicodeDecodeError):
                pass
    out.reverse()
    return out


def _tg_next_id():
    """So thu tu alarm, tang dan. Lan dau trong phien thi noi tiep tu dong cuoi log."""
    global _TG_SEQ
    if not _TG_SEQ:
        _TG_SEQ = max([r.get('id') or 0 for r in _tg_log_tail()] or [0])
    _TG_SEQ += 1
    return _TG_SEQ


def _tg_alarm_log(aid, ev, cap):
    """Ghi nguon clip cua alarm de /video <id> keo lai duoc. Append-only, khong lock."""
    rec = {'id': aid, 'ts': ev.get('ts') or int(time.time()), 'cap': cap,
           'url': ev.get('video_url') or '', 'file': ev.get('video') or '',
           'algo': ev.get('algo_model') or ''}
    try:
        with open(_TG_ALARM_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except OSError as e:
        print('[tg] khong ghi duoc alarm log:', e)


# ------------------------------------------------- che do /setup <ten>  (c27)
# Cham cong theo thu vien nguoi 'Default List'. State cua NGAY o
# DATA/tg_person_today.json — doi ngay thi reset (moc 00:00 nguoi dung da chon).
# Lich su xuat hien ghi append-only vao DATA/tg_person_log.jsonl: muon biet "lan 1
# o camera nao, lan 2 o dau" thi loc file theo person roi sap theo ts.
_C27_LOCK = threading.Lock()
_C27_TODAY = os.path.join(DATA, 'tg_person_today.json')
_C27_LOG = os.path.join(DATA, 'tg_person_log.jsonl')
_C27_LIB = 'Default List'
_C27_DEADLINE = 8 * 3600 + 30 * 60        # 08:30 — truoc gio nay khong tinh di muon
_C27_CLOSE = 17 * 3600 + 30 * 60          # 17:30 — sau gio nay gui ca alarm vo danh


def _c27_hm(ts):
    """(giay-trong-ngay, 'YYYY-MM-DD', epoch 08:30 cua ngay do) theo gio may."""
    t = time.localtime(ts or time.time())
    return (t.tm_hour * 3600 + t.tm_min * 60, time.strftime('%Y-%m-%d', t),
            time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 8, 30, 0, 0, 0, -1)))


def _c27_load(day):
    """State cua `day`. File mang ngay khac (hoac hong) -> state trang = reset."""
    try:
        with open(_C27_TODAY, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict) and d.get('date') == day:
            for k, zero in (('first', {}), ('late', []), ('uniform', [])):
                if not isinstance(d.get(k), type(zero)):
                    d[k] = zero
            return d
    except (OSError, ValueError):
        pass
    return {'date': day, 'first': {}, 'late': [], 'uniform': []}


def _c27_save(st):
    try:
        with open(_C27_TODAY, 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
    except OSError as e:
        print('[c27] khong luu duoc state:', e)


def _c27_person(ev):
    """Ten nguoi nhan dien duoc TRONG thu vien, hoac '' neu vo danh / khac thu vien."""
    p = ev.get('person') or {}
    name = str(p.get('name') or '').strip()
    lib = str(p.get('lib') or '').strip()
    return '' if (not name or (lib and lib != _C27_LIB)) else name


def _c27_decide(ev):
    """Quyet dinh cho che do /setup <ten>. Tra (title, co_gui, mark).
      title = chu de thay cho ten algo, None = giu nguyen
      mark  = ('late'|'uniform', ten) — CHI goi _c27_mark sau khi gui that, de mot
              alarm bi mat anh khong danh dau oan roi chan nguoi do ca ngay.
    Moi lan nhan dien duoc deu ghi lich su xuat hien + lan dau tien trong ngay, KE CA
    khi alarm nay khong duoc gui — nguoi do van da co mat, xet di muon phai biet."""
    algo = ev.get('algo_model') or ''
    ts = int(ev.get('ts') or time.time())
    sec, day, deadline = _c27_hm(ts)
    person = _c27_person(ev)
    with _C27_LOCK:
        st = _c27_load(day)
        changed = False
        if person:
            try:
                with open(_C27_LOG, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(
                        {'ts': ts, 'day': day, 'person': person,
                         'cam': ev.get('channel_name') or '', 'algo': algo,
                         'sim': (ev.get('person') or {}).get('similarity')},
                        ensure_ascii=False) + '\n')
            except OSError as e:
                print('[c27] khong ghi duoc lich su:', e)
            if person not in st['first']:
                st['first'][person] = {'ts': ts, 'cam': ev.get('channel_name') or '',
                                       'algo': algo}
                changed = True
        # EnterArea va Absence(OffDutyDetectionAlarm): LUON gui + doi ten. Hai loai
        # nay khong bao gio kem nhan dien nguoi (0/322 ban ghi OffDuty co
        # compare_results) nen khong the theo luat "chi gui khi biet la ai".
        if algo == 'EnterArea':
            title, send, mark = 'Xâm phạm khu vực', True, None
        elif algo == 'OffDutyDetectionAlarm':
            title, send, mark = '1 người đã ra khỏi phòng 15 phút trước', True, None
        elif algo == 'LineDetectorCrossed':
            if sec < _C27_DEADLINE:
                # 00:00-08:30: im lang (van ghi lan xuat hien dau de xet di muon)
                title, send, mark = None, False, None
            elif sec >= _C27_CLOSE:
                title, send, mark = None, True, None      # sau 17:30: gui binh thuong
            else:
                # 08:30-17:30: KHONG gui tin "vuot vach". Chi bao di muon khi lan
                # xuat hien DAU TIEN trong ngay la SAU 08:30, 1 lan/nguoi/ngay.
                first = st['first'].get(person) if person else None
                late = bool(person) and person not in st['late'] \
                    and bool(first) and first['ts'] >= deadline
                if late:
                    title, send, mark = f'{person} đã đi muộn', True, ('late', person)
                else:
                    title, send, mark = None, False, None
        elif algo == 'WorkClothesAlarm':
            # Chi bao khi biet la ai, va 1 lan/nguoi/ngay.
            if person and person not in st['uniform']:
                title, send, mark = 'Sai đồng phục', True, ('uniform', person)
            else:
                title, send, mark = 'Sai đồng phục', False, None
        else:
            # Con lai: truoc 17:30 chi gui khi nhan dien duoc nguoi; sau 17:30 gui het.
            title, send, mark = None, (bool(person) or sec >= _C27_CLOSE), None
        if changed:
            _c27_save(st)
    return title, send, mark


def _c27_mark(ev, mark):
    """Danh dau da gui 'late'/'uniform' cho nguoi nay. Lay ngay theo ts CUA ALARM
    (giong _c27_decide) de alarm luc 23:59:59 khong bi danh dau sang ngay hom sau."""
    kind, person = mark
    with _C27_LOCK:
        st = _c27_load(_c27_hm(ev.get('ts'))[1])
        if person not in st[kind]:
            st[kind].append(person)
            _c27_save(st)


def _tg_forward(ev):
    """Chay trong thread rieng. Alarm -> caption + ANH + id, gui toi nhom da /setup.
    KHONG tu gui clip nua: nguoi dung go /video <id> khi can (xem _tg_send_video)."""
    try:
        if ev.get('kind') != 'alarm':
            return                       # clip box day ve: khong tu gui
        # Loc truoc: keepalive (type 6) va dem nguoi (AreaRuleData) khong can gui Telegram
        if ev.get('type') == 6 or ev.get('algo_model') == 'AreaRuleData':
            return
        chats = CONN.get('tg_chats') or []
        setups = CONN.get('tg_setup') or {}
        # Che do /setup <ten>: _c27_decide co side effect (ghi lich su xuat hien)
        # nen goi DUNG 1 LAN cho ca event, khong goi theo tung nhom.
        if any((setups.get(str(c)) or {}).get('mode') == 'rule' for c in chats):
            title, send, mark = _c27_decide(ev)
        else:
            title, send, mark = None, True, None
        chats = _tg_targets(ev, send)
        if not chats:
            return                       # chua /setup, hoac c27 chan -> im lang
        img = _tg_image(ev)
        if not img:
            # Khong co anh -> IM. Gui text khong anh chi lam loang nhom (alarm loi,
            # box chua kip luu anh). Caption con o log.
            print(f'[tg] bo qua (khong co anh): {ev.get("algo_model")}')
            return
        aid = _tg_next_id()
        cap = _tg_caption(ev, aid, title)
        _tg_alarm_log(aid, ev, cap)
        if mark:
            _c27_mark(ev, mark)          # danh dau SAU khi chac chan co cai de gui
        print(f'[tg] gui anh #{aid} cho {ev.get("algo_model")} ({len(img[1])} bytes)')
        _tg_send_all('sendPhoto', {'caption': cap}, {'photo': img}, chats)
    except Exception as e:
        print('[tg] forward that bai:', e)


def _save_images(alarm, stamp):
    """Anh ve 3 cach: base64 tran trong JSON, path de GET ve tu box, hoac khong co.
    Tra (saved, person_img): saved = danh sach anh da luu; person_img = URL anh mat
    cua nguoi duoc nhan dien (compare_results[0]) neu co. Anh mat nguoi luu ten
    rieng (tag 'person') de KHONG trung/de anh camera — truoc day behaviour va
    compare_results cung viet vao {stamp}_image_base64.jpg nen cai sau de len cai
    truoc, thumnail type 5 ra anh mat nguoi thay vi anh camera."""
    saved, person_img = [], None
    groups = [(alarm.get('behaviour'), 'cam'), (alarm.get('face'), 'cam')]
    for r in (alarm.get('compare_results') or []):
        groups.append((r, 'person'))
    for obj, tag in groups:
        if not isinstance(obj, dict):
            continue
        for key in ('image_base64', 'orig_image_base64', 'crop_image_base64'):
            if obj.get(key):
                fn = os.path.join(ALARM_DIR, f'{stamp}_{tag}_{key}.jpg')
                with open(fn, 'wb') as f:
                    f.write(base64.b64decode(obj[key]))
                saved.append(os.path.basename(fn))
                if tag == 'person' and person_img is None:
                    person_img = os.path.basename(fn)
        for key in ('image_path', 'orig_image_path', 'crop_image_path'):
            if obj.get(key):
                url = '/aibox/picture?' + obj[key].split('?', 1)[-1]
                saved.append(url)
                if tag == 'person' and person_img is None:
                    person_img = url
    return saved, person_img


def _norm_alarm(alarm, images=None, person_image=None):
    """JSON tho cua box -> event cho UI. Dung cho ca alarm push VA khi doc lai
    alarms.jsonl (tab Nhat ky can lich su, khong chi cai toi trong phien nay)."""
    ci = alarm.get('channel_info') or {}
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    t = alarm.get('type')
    return {'kind': 'alarm', 'ts': obj.get('capture_time') or int(time.time()),
            'type': t, 'label': TYPES.get(t, str(t)),
            'channel_id': ci.get('channel_id', alarm.get('channel_id')),
            'channel_name': ci.get('channel_name') or alarm.get('channel_name'),
            'ipc_addr': ci.get('ipc_addr'),
            'event_id': alarm.get('event_id'),
            'algo_model': obj.get('algo_model') or alarm.get('algo_model'),
            # Danh sach doi tuong phat hien (capture_info): moi phan tu 1 doi tuong
            # (object_type, target_id, toa do...). Dung de ghi so doi tuong vao Telegram.
            'capture_info': obj.get('capture_info') or [],
            # Người được nhận diện (compare_results[0]): tên + độ chính xác + ảnh mặt.
            # Box gửi kèm ở type 4 (face match) và type 5 (behavior + face match).
            'person': _person_of(alarm, person_image),
            # Đếm người trong vùng (AreaRuleData): con số real-time, không phải alarm
            'area_num': obj.get('area_num'),
            # Box KHONG day file video — chi gui video_url dang
            # /api/v2/smart/video?ChlId=..&StartTime=..&EndTime=.. de KEO clip ve.
            # Doi sang route proxy cua bridge de browser goi duoc (co digest auth).
            'video_url': ('/aibox/video?' + obj['video_url'].split('?', 1)[-1]
                          if obj.get('video_url') else None),
            'video_uuid': obj.get('video_uuid'),
            'images': images if images is not None else _images_of(alarm)}


def _person_of(alarm, person_image):
    """Ten + do chinh xac + anh mat cua nguoi duoc nhan dien. person_image la URL
    da co san (live) hoac None de tu resolve tu compare_results (doc lai jsonl)."""
    for r in (alarm.get('compare_results') or []):
        if not isinstance(r, dict):
            continue
        if r.get('person_name') or r.get('similarity') is not None:
            out = {'name': r.get('person_name'),
                   'similarity': r.get('similarity'),
                   'lib': r.get('lib_name')}
            img = person_image
            if not img:
                for key in ('image_path', 'crop_image_path'):
                    if r.get(key):
                        img = '/aibox/picture?' + r[key].split('?', 1)[-1]
                        break
            if img:
                out['image'] = img
            return out
    return None


def _images_of(alarm):
    """Ten file anh da luu cho alarm nay. Khi doc lai tu jsonl thi anh base64 da
    duoc ghi ra dia tu truoc — doi chieu bang capture_time + algo_model."""
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    out = []
    for key in ('image_path', 'orig_image_path', 'crop_image_path'):
        if obj.get(key):
            out.append('/aibox/picture?' + obj[key].split('?', 1)[-1])
    return out


def handle_alarm(body, ctype):
    os.makedirs(ALARM_DIR, exist_ok=True)
    stamp = time.strftime('%Y%m%d_%H%M%S') + f'_{secrets.token_hex(3)}'

    if 'multipart' in (ctype or ''):                # 13.2 video / 13.3 PDF
        msg = BytesParser().parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        uuid, blob, name = None, None, 'upload.bin'
        for part in msg.walk():
            if part.get_content_maintype() == 'multipart':
                continue
            disp = part.get_param('name', header='content-disposition')
            payload = part.get_payload(decode=True) or b''
            if disp == 'video_uuid':
                uuid = payload.decode(errors='replace').strip()
            elif payload:
                blob, name = payload, part.get_filename() or name
        if blob:
            fn = os.path.join(ALARM_DIR, f'{uuid or stamp}_{name}')
            with open(fn, 'wb') as f:
                f.write(blob)
            # Khong co bao dam thu tu: video co the den truoc alarm JSON.
            _video_buf[uuid] = os.path.basename(fn)
            _publish({'kind': 'video', 'video_uuid': uuid, 'file': os.path.basename(fn)})
        return

    alarm = json.loads(body or b'{}')
    t = alarm.get('type')
    # Box thinh thoang POST body rong/{} nhu heartbeat keep-alive loi (kep giua hai
    # type 6 trong jsonl). Khong phai phat hien: bo qua, khong ghi jsonl khong publish.
    if t is None:
        return
    # Chong "lay lai hang cu": vua mat ket noi voi box roi noi lai, box day lai alarm
    # cu -> chi giu alarm moi nhat, bo hang cu. Bo truoc khi luu anh/jsonl/publish.
    _ct = (alarm.get('behaviour') or alarm.get('face') or {}).get('capture_time')
    if isinstance(_ct, (int, float)) and not _box_lag_gate(_ct):
        print(f'[box] bo alarm CU sau khi noi lai (hang cu, capture_time {_ct})')
        return
    # Firmware ECS-516S-SF-HD KHONG dat channel_id/channel_name o top-level nhu doan
    # ban dau — chung nam trong channel_info{channel_id, channel_name, ipc_addr,
    # ipc_sn}. capture_time cung nam trong behaviour/face, khong o top-level.
    saved, person_img = _save_images(alarm, stamp)
    ev = _norm_alarm(alarm, images=saved, person_image=person_img)
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    # AreaRuleData = dem nguoi trong vung (real-time) -> cap nhat so moi nhat cho /countpeople.
    if obj.get('algo_model') == 'AreaRuleData' and ev.get('channel_id') is not None:
        _AREA[str(ev['channel_id'])] = {'count': ev.get('area_num'),
                                        'name': ev.get('channel_name') or ('CH' + str(ev['channel_id'])),
                                        'ts': int(time.time())}
    uuid = obj.get('video_uuid')
    if uuid:
        ev['video_uuid'] = uuid
        ev['video'] = _video_buf.pop(uuid, None)
    with open(os.path.join(ALARM_DIR, 'alarms.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(alarm, ensure_ascii=False) + '\n')
    _publish(ev)


# ------------------------------------------------------ docking /alarm URL
def _docking_info():
    """Doc platform 1|2 trong box de UI hien "ai dang giu slot nao". Tra dict
    {'ok': bool, 'err': str, 'slots': [{slot, enabled, url, owner}]}. owner = IP
    rut ra tu url, '' neu slot trong. Chua co IP/pass -> ok=False, slots=[]."""
    out = {'ok': False, 'err': '', 'slots': []}
    if not CONN['host'] or not CONN['pass']:
        out['err'] = 'Chua dien IP/mat khau box (tab Cau hinh)'
        return out
    try:
        r = box.call('/api/v2/docking/config/get', {})
        if r.get('code') != 0:
            out['err'] = r.get('msg') or f'box loi code {r.get("code")}'
            return out
        plats = [p for p in (r.get('data') or {}).get('platform') or [] if isinstance(p, dict)]
        # Luon tra du 2 slot (1,2), du co trong box hay khong.
        by_id = {p.get('id'): p for p in plats}
        for sid in (1, 2):
            p = by_id.get(sid)
            if not p:
                out['slots'].append({'slot': sid, 'enabled': 0, 'url': '', 'owner': ''})
                continue
            url = p.get('url') or ''
            # owner = IP/host rut ra tu url, bo http(s):// va /alarm
            owner = url.replace('/alarm', '').split('//')[-1] if url else ''
            out['slots'].append({'slot': sid, 'enabled': p.get('enabled', 0),
                                 'url': url, 'owner': owner})
        out['ok'] = True
    except Exception as e:
        out['err'] = str(e)
    return out


def _docking_register(slot):
    """Tu dang ky alarm URL cua may nay vao box, slot platform 1|2. May nay tu
    lay IP (lan_ip -> ip dung interface di toi box), ghi URL http://<ip>:<PORT>/alarm
    vao phan tu platform co id=slot (tao neu chua co), giu nguyen moi truong khac
    (time_conf, picture/video flags...). Box chi nhan toi 2 platform, 1 may 1 slot.
    Tra (ok, msg, url). url = URL da dang ky, '' neu loi."""
    if not CONN['host'] or not CONN['pass']:
        return False, 'Chua dien IP/mat khau box (tab Cau hinh)', ''
    url = f'http://{lan_ip()}:{PORT}/alarm'
    try:
        r = box.call('/api/v2/docking/config/get', {})
        if r.get('code') != 0:
            return False, r.get('msg') or f'box loi code {r.get("code")}', ''
        d = r.get('data') or {}
        time_conf = d.get('time_conf') or []
        plats = [p for p in (d.get('platform') or []) if isinstance(p, dict)]
        # Tim phan tu dung slot (id=slot); giu nguyen flags cua no neu co.
        one = next((p for p in plats if p.get('id') == slot), None)
        if one is None:
            # Slot trong -> tao moi theo khuon phan tu mac dinh cua box.
            tpl = plats[0] if plats else {}
            one = {k: tpl.get(k) for k in ('picture_enable', 'video_enable', 'http_alive',
                                           'alive_interval', 'channel_enable', 'report_mode',
                                           'fuelunload_report_mode', 'pdf_enable', 'retry_enable',
                                           'retry_type', 'retry_value') if k in tpl}
            one['id'] = slot
            one['enabled'] = 1
            one['url'] = url
            one['alive_url'] = url
            one['video_url'] = ''
            one['pdf_url'] = ''
            one['version_code'] = tpl.get('version_code') or 'V2.0'
            plats.append(one)
        else:
            one['enabled'] = 1
            one['url'] = url
            one['alive_url'] = url
        body = {'platform': plats, 'time_conf': time_conf}
        up = box.call('/api/v2/docking/config/update', body)
        if up.get('code') != 0:
            return False, up.get('msg') or f'update loi code {up.get("code")}', ''
        return True, '', url
    except Exception as e:
        return False, str(e), ''


# ------------------------------------------------------------------- http server
class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=UI_DIR, **kw)

    def log_message(self, fmt, *a):
        pass

    def _local_only(self, path):
        """True = tu choi. Gio MO HET cho LAN: app Electron o may khac phuc vu
        giao dien tai 127.0.0.1:<port> roi goi API ve day qua LAN. Truoc day chi
        /alarm mo ra LAN, phan con lai khoa localhost.

        CANH BAO: KHONG co dang nhap. Ai vao duoc LAN cung xem duoc camera, xoa
        duoc camera (/aibox/channel/delete), doi duoc IP/mat khau box (/api/conn)
        va doc duoc mat khau camera (go2rtc :1984/api/streams).

        Day la DIEM CHAN DUY NHAT cua moi request (do_GET/do_POST/do_OPTIONS/
        do_HEAD deu goi ham nay). Them lai dang nhap thi dat dung o day, dung rai
        ra tung route. /alarm phai luon mo: box POST vao tu IP khac, khong cookie."""
        return False

    def guess_type(self, path):
        # SimpleHTTPRequestHandler tra 'text/html' tron -> browser doan windows-1252
        # va tieng Viet thanh mojibake ("Tat ca" -> "Táº¥t cáº£"). File deu la UTF-8.
        t = super().guess_type(path)
        base = t.split(';')[0].strip()
        if base.startswith('text/') or base in ('application/javascript', 'application/json'):
            return base + '; charset=utf-8'
        return t

    def end_headers(self):
        """Chan cache cho file UI. ES module bi browser cache rat dai: server da tra
        code moi ma trang van chay ban cu trong bo nho (sua go() xong, tab Camera van
        an). SimpleHTTPRequestHandler chi gui Last-Modified, khong Cache-Control ->
        browser tu quyet dinh khong revalidate. Day la file local, cache khong loi gi."""
        p = urlparse(self.path).path
        if p == '/' or p.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def _cors(self):
        # UI co the duoc go2rtc serve o :1984 -> khac origin voi :8090.
        # Chi mo cho localhost, khong phai '*': endpoint nay goi duoc vao box.
        o = self.headers.get('Origin', '')
        if re.match(r'^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$', o):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self._cors()
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        if self._local_only(urlparse(self.path).path):
            return
        self.send_response(204)
        self._cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def _body(self):
        """Doc body MOT lan roi cache. Route nao khong goi _body() van phai doc het:
        voi HTTP/1.1 keep-alive byte body con lai trong socket se bi parse thanh
        request-line cua request KE TIEP -> 501 Unsupported method. Lan dau vao tab
        Camera hong dung kieu nay."""
        if self._cached is None:
            self._cached = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        return self._cached

    def do_POST(self):
        p = urlparse(self.path).path
        self._cached = None
        self._body()                            # drain truoc khi route
        if self._local_only(p):
            return
        try:
            if p == '/alarm':                       # box POST ve day, ack code 200
                handle_alarm(self._body(), self.headers.get('Content-Type'))
                return self._json({'code': 200, 'msg': 'ok'})
            if p == '/api/conn':                    # luu IP/user/pass tu tab Cau hinh
                req = json.loads(self._body() or b'{}')
                host = str(req.get('host', '')).strip()
                if not re.match(r'^[A-Za-z0-9._\-]{1,253}$', host):
                    return self._json({'code': 2, 'msg': 'IP/hostname khong hop le'}, 400)
                CONN['host'] = host
                CONN['port'] = max(1, min(65535, int(req.get('port') or 80)))
                CONN['user'] = str(req.get('user', '')).strip() or 'admin'
                if req.get('pass'):                 # bo trong = giu mat khau cu
                    CONN['pass'] = str(req['pass'])
                box.chal, box.nc = None, 0          # doi box/tai khoan -> challenge cu vo nghia
                save_conf()
                # Tu dang ky alarm URL vao box theo slot da chon (1|2). Co IP+pass moi
                # dang ky duoc; thieu thi bao nhung khong loi — nguoi dung dien sau.
                dk_slot = int(req.get('slot') or 1)
                dk_ok, dk_err, dk_url = _docking_register(dk_slot) if (CONN['host'] and CONN['pass']) else (False, 'chua co IP/mat khau', '')
                info = conn_info()
                info['docking'] = {'slot': dk_slot, 'ok': dk_ok, 'err': dk_err, 'url': dk_url}
                return self._json({'code': 0, 'msg': 'Da luu', 'data': info})
            if p == '/api/conn/tgsave':             # luu rieng tg_token + cac nhom da tick
                req = json.loads(self._body() or b'{}')
                if str(req.get('tg_token', '')).strip():
                    CONN['tg_token'] = str(req['tg_token']).strip()
                if 'tg_chats' in req:               # list chat_id da chon ([] = tat)
                    raw = req.get('tg_chats') or []
                    if isinstance(raw, (list, tuple)):
                        CONN['tg_chats'] = [str(c).strip() for c in raw if str(c).strip()]
                save_conf()
                return self._json({'code': 0, 'msg': 'Da luu', 'data': conn_info()})
            if p == '/api/tg/groups':               # list nhom bot thay -> tick chon
                groups, err = _tg_discover()
                return self._json({'code': 0 if not err else 1, 'msg': err or 'ok',
                                   'data': {'groups': groups,
                                            'selected': CONN.get('tg_chats') or []}})
            if p == '/api/tg/chatname':              # resolve Chat ID tu nhap tay -> ten that
                req = json.loads(self._body() or b'{}')
                cid = str(req.get('id', '')).strip()
                if not cid:
                    return self._json({'code': 2, 'msg': 'Thieu chat_id'})
                name, cid_canon, err = _tg_chat_info(cid)
                return self._json({'code': 0 if name else 1, 'msg': err or 'ok',
                                   'data': {'id': cid_canon or cid, 'title': name or cid}})
            if p == '/api/conn/docking/info':      # doc platform 1|2 trong box -> ai dang giu slot
                dk = _docking_info()
                return self._json({'code': 0, 'msg': 'ok', 'data': dk})
            if p == '/api/conn/test':
                r = box.call('/api/v2/device/get')
                return self._json({'code': r.get('code'), 'msg': r.get('msg'),
                                   'data': r.get('data', {})})
            if p == '/api/conn/docking':            # tu dang ky alarm URL vao box, slot 1|2
                req = json.loads(self._body() or b'{}')
                slot = int(req.get('slot') or 1)
                ok, err, url = _docking_register(slot)
                return self._json({'code': 0 if ok else 1, 'msg': err or f'Đã đăng ký alarm → platform {slot}',
                                   'data': {'url': url, 'slot': slot}})
            if p == '/api/conn/tgtest':             # gui tin nhan thu vao moi nhom da chon
                chats = CONN.get('tg_chats') or []
                if not (CONN.get('tg_token') and chats):
                    return self._json({'code': 3, 'msg': 'Chua dien bot token hoac chua tick nhom nao'})
                fails = []
                for c in chats:
                    ok, err = _tg_post('sendMessage', c, {'text': '✅ Vibotics SmartBox — test Telegram OK'})
                    if not ok:
                        fails.append(f'{c}: {err}')
                if fails:
                    return self._json({'code': 4, 'msg': '; '.join(fails)})
                return self._json({'code': 0, 'msg': f'Đã gửi tới {len(chats)} nhóm — mở Telegram để xem'})
            if p == '/api/algo/all':                # 94 ho tro + 14 dang nap + cong suat
                sup = box.call('/api/v2/algo/list')
                cur = box.call('/api/v2/algo/list/current')
                hr = box.call('/api/v2/smart/hashinfo/get',
                              {'channel_id': 1, 'algo_model': []})
                return self._json({'code': 0, 'data': {
                    'supported': (sup.get('data') or {}).get('algo_model') or [],
                    'loaded': (cur.get('data') or {}).get('algo_model') or [],
                    'hashrate': (hr.get('data') or {}).get('hashrate'),
                    'max': 20,          # web UI box: "Max. 20 algorithms are allowed."
                }})
            if p == '/api/algo/save':           # nap bo thuat toan cho CA BOX
                # Web UI box goi postCapabilities -> POST "/api/v2/algo/capabilities "
                # (CO dau cach cuoi duong dan — khong phai loi danh may, bundle cua
                # box viet nhu vay). Body chua dò ra: {algo_model:[...]} va 3 shape
                # khac deu tra code 1. Thu lan luot, tra ve loi that neu ca 4 fail.
                q = json.loads(self._body() or b'{}')
                models = q.get('algo_model') or []
                if not isinstance(models, list) or not all(isinstance(m, str) for m in models):
                    return self._json({'code': 2, 'msg': 'algo_model phai la mang chuoi'}, 400)
                if len(models) > 20:
                    return self._json({'code': 2, 'msg': f'Toi da 20 thuat toan, dang gui {len(models)}'}, 400)
                # PAYLOAD + PATH — ca hai lay tu bundle web box, da XAC NHAN chay:
                #   postCapabilities({config: e, clear_flag: 0})
                #   e = checkedAlgo.map(m => ({algo_model: m}))
                #
                # HAI CAI BAY, ca hai deu tra code 1 Common Error neu sai:
                #  1. config la mang OBJECT {algo_model}, KHONG phai mang chuoi.
                #  2. PATH PHAI SACH. Bundle viet "/api/v2/algo/capabilities " co dau
                #     cach cuoi, nhung fetch() cua browser TU CAT khoang trang cuoi URL
                #     (chuan WHATWG) -> box thuc te nhan path sach. Gui %20 la path
                #     KHAC, box tu choi.
                #
                # clear_flag 1 = xoa du lieu cu (web box hoi truoc khi dung), 0 = giu.
                #
                # CANH BAO: lenh nay ghi TRON danh sach. Thuat toan khong co trong
                # `models` se bi XOA khoi box. Da tung mat WorkClothesAlarm vi gui
                # thieu. UI phai gui du bo dang chon, khong phai chi cai vua tick.
                r = box.call('/api/v2/algo/capabilities',
                             {'config': [{'algo_model': m} for m in models],
                              'clear_flag': 1 if q.get('clear') else 0})
                if r.get('code') == 0:
                    return self._json({'code': 0, 'data': r.get('data'),
                                       'msg': f'Da nap {len(models)} thuat toan'})
                return self._json({'code': r.get('code'), 'msg': r.get('msg'),
                                   'status_code': r.get('status_code')}, 502)
            if p == '/api/cameras':                 # danh sach camera + AI dang bat
                ch = box.call('/api/v2/channel/list',
                              {'page': 1, 'pagesize': 100, 'channel_name': ''})
                if ch.get('code') != 0:
                    return self._json(ch)
                en = box.call('/api/v2/smart/enable/list')
                # /smart/enable/list tra ARRAY o data (khong phai object) — 16 kenh
                emap = {e.get('channel_id'): e for e in (en.get('data') or [])
                        if isinstance(e, dict)}
                out = []
                for c in (ch.get('data') or {}).get('channel_list') or []:
                    cid = c.get('channel_id')
                    e = emap.get(cid) or {}
                    out.append({'channel_id': cid, 'name': c.get('channel_name'),
                                'ip': c.get('ip'), 'status': c.get('status'),
                                'model': c.get('model'), 'stream': f'ch{cid}',
                                'ai_on': e.get('status'),
                                'algos': e.get('algo_model') or [],
                                'rtsp': c.get('rtsp'), 'username': c.get('username'),
                                'transport_type': c.get('transport_type'),
                                'custom_code': c.get('custom_code') or ''})
                return self._json({'code': 0, 'data': out})
            if p == '/api/hashrate':                # cong suat khi ap dung 1 bo algo
                q = json.loads(self._body() or b'{}')
                return self._json(box.call('/api/v2/smart/hashinfo/get', {
                    'channel_id': int(q.get('channel_id') or 1),
                    'algo_model': q.get('algo_model') or []}))
            if p == '/api/alarms':              # lich su tu alarms.jsonl cho tab Nhat ky
                # AL o ai.js bat dau RONG -> khong co endpoint nay thi timeline
                # trong tron cho den khi co canh bao MOI toi. Doc nguoc tu cuoi file.
                fn = os.path.join(ALARM_DIR, 'alarms.jsonl')
                out = []
                # UI cần seed 'số người trong vùng' ngay sau refresh: gọi với
                # {'include_area': true} để nhận cả AreaRuleData (kèm _is_area).
                # Mặc định vẫn lọc — tab Nhật ký không bị tràn bởi event đếm.
                try:
                    _incl_area = bool((json.loads(self._body() or b'{}'))
                                      .get('include_area'))
                except json.JSONDecodeError:
                    _incl_area = False
                out = []
                if os.path.exists(fn):
                    with open(fn, encoding='utf-8') as f:
                        lines = f.readlines()[-1500:]
                    for ln in reversed(lines):
                        try:
                            a = json.loads(ln)
                        except json.JSONDecodeError:
                            continue
                        # Loc TRUOC khi dem du 300, keo 300 slot bi an boi tin hieu
                        # khong phai canh bao (AreaRuleData day ~1 dong/giay: khong loc
                        # thi ca 300 dong la dem nguoi, tab Nhat ky trang tron):
                        #   2 = Alarm Recovery (bao HET canh bao, khong co anh)
                        #   6 = keep-alive, 7 = doi trang thai channel
                        #   AreaRuleData = dem nguoi trong vung (UI da coi la khong canh bao)
                        ob = a.get('behaviour') or a.get('face') or {}
                        if a.get('type') in (2, 6, 7):
                            continue
                        if ob.get('algo_model') == 'AreaRuleData':
                            if not _incl_area:
                                continue
                            out.append({**_norm_alarm(a), '_is_area': True})
                        else:
                            out.append(_norm_alarm(a))
                        if len(out) >= 300:
                            break
                return self._json({'code': 0, 'data': out})
            if p == '/api/discover':                 # kich hoat Auto Search tren box (V1)
                status, data = box.raw('PUT', '/API/V1.0/System/DiscoverDevice')
                try:
                    return self._json(json.loads(data or b'{}'))
                except json.JSONDecodeError:
                    return self._json({'code': -1, 'msg': f'HTTP {status}: {data[:200]!r}'}, 502)
            if p == '/api/discover/list':            # ket qua Auto Search (V1)
                status, data = box.raw('GET', '/API/V1.1/System/DiscoverDevice')
                try:
                    raw = json.loads(data or b'{}')
                except json.JSONDecodeError:
                    return self._json({'code': -1, 'msg': f'HTTP {status}: {data[:200]!r}'}, 502)
                if raw.get('status_code') != 0:
                    return self._json({'code': raw.get('status_code', -1), 'msg': raw.get('msg', 'Discover failed')})
                return self._json({'code': 0, 'data': parse_discover(raw)})
            if p == '/api/sync':
                return self._json(sync_streams())
            if p == '/api/channel/add':             # RSA -> onvif probe -> add
                return self._json(self._add_channel(json.loads(self._body() or b'{}')))
            if p == '/api/channel/update':          # sua camera type=2 tren box
                return self._json(self._update_channel(json.loads(self._body() or b'{}')))
            if p == '/api/channel/delete':          # xoa camera khoi box
                q = json.loads(self._body() or b'{}')
                return self._json(box.call('/api/v2/channel/delete', q))
            if p.startswith('/aibox/'):             # proxy thang sang box
                return self._json(box.call('/api/v2/' + p[len('/aibox/'):],
                                           json.loads(self._body() or b'{}')))
            self.send_error(404)
        except Exception as e:
            self._json({'code': -1, 'msg': f'{type(e).__name__}: {e}'}, 500)

    def _update_channel(self, req):
        """Update a direct RTSP channel without exposing or requiring its password."""
        cid = req.get('channel_id')
        name = (req.get('channel_name') or '').strip()
        rtsp = (req.get('rtsp') or '').strip()
        if not isinstance(cid, int) or cid < 1:
            return {'code': 2, 'msg': 'channel_id: bắt buộc'}
        if not name or len(name) > 64:
            return {'code': 2, 'msg': 'channel_name: bắt buộc và tối đa 64 ký tự'}
        if not rtsp or len(rtsp.encode('utf-8')) > 1023 or len(rtsp) > 256:
            return {'code': 2, 'msg': 'rtsp: bắt buộc và tối đa 256 ký tự'}
        esc = lambda s: re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', s)
        body = {'channel_id': cid, 'channel_name': name, 'type': 2,
                'rtsp': esc(rtsp), 'transport_type': int(req.get('transport_type') or 1)}
        if req.get('custom_code') is not None:
            body['custom_code'] = str(req['custom_code'])[:64]
        return box.call('/api/v2/channel/update', body)

    def _add_channel(self, req):
        """Hai duong, tai lieu muc 4.3:
          type=2 (rtsp truc tiep) -> goi THANG channel/add kem `rtsp`. Khong RSA,
            khong channel/device/info. 8/8 channel that tren box deu la type nay.
          type=1 (onvif)          -> publickey -> encrypt pwd -> device/info -> add.

        Dieu kien bat buoc (bang tham so 4.3 + AddChannel.3c964a69.js tu web box):
          type          integer, YES. 1=onvif, 2=rtsp, (3=GB/LAPI vendor-specific).
          channel_name  string, YES. Web box: nameRules = required + ≤64 chars + not-blank
                        (RegExp_space = /^(?!\\s*$).+/). Bang ma loi _apidoc.txt:2108 noi
                        400317 qua 10 ky tu / 400318 co dau cach, NHUNG web vendor cho
                        phep 64 va khong cam dau cach → tin web hon bang loi (co the cu).
                        8/8 channel that deu '001'..'008' (3 ky tu ASCII, khong test duoc).
          rtsp          string, bat buoc khi type=2. ≤1023 byte, PHẢI percent-encode
                        '%' → '%25' truoc khi gui (box percent-decode; raw '%' bi tu
                        choi 60062). Chi escape userinfo, khong cham path/query.
          transport_type integer — "No" NHUNG ghi chu "required for AIBOX, not VMS".
                        Day la AIBOX → luon gui. 1 tcp / 2 udp / 3 lapi.
          ip/port/username/pwd  chi can cho type=1; pwd RSA-encrypted PKCS#1 v1.5.
                        `port` = cong ONVIF/HTTP (mac dinh 80), KHONG phai 554 rtsp.
          video_id      chi can khi video_type=2 (custom stream, lay tu device/info).
        Tra ve data.channel_id. Box toi da 16 channel (400316 = vuot gioi han)."""
        name = (req.get('channel_name') or '').strip()
        # Vendor web: required + <=64 + not-blank. Bang ma loi noi <=10 / khong dau cach
        # nhung do la /channel/update, va web cho phep 64. Tin web (firmware companion).
        if not name or not name.strip():   # not-blank (vendor RegExp_space)
            return {'code': 2, 'msg': 'channel_name: bat buoc, khong duoc chi toan khoang trang'}
        if len(name) > 64:
            return {'code': 2, 'msg': 'channel_name: toi da 64 ky tu'}
        rtsp = (req.get('rtsp') or '').strip()
        if rtsp:
            # Vendor web: <=1023 bytes. Bang tham so ghi 256. Vendor la firmware companion.
            if len(rtsp.encode('utf-8')) > 1023:
                return {'code': 2, 'msg': 'rtsp: toi da 1023 byte UTF-8'}
            if len(rtsp) > 256:
                return {'code': 2, 'msg': 'rtsp toi da 256 ky tu'}
            # PHAI percent-encode '%' trong userinfo thanh '%25' TRUOC khi gui. Box
            # percent-DECODE rtsp truoc khi luu → gui raw '%' bi box tu choi 60062
            # (Invalid Arguments) vi '%' khong di sau cap hex. Bang chung truc tiep:
            #   raw   'Dahua123456%@...'  → 60062
            #   escaped'Dahua123456%25@...'→ code 0, luu ve raw '%' (channel '0111'
            #   tren box dang online luu DUNG 'Dahua123456%@').
            # NHAM LAN da sua: khong doc 'chl.json' nhu y "gui raw" — do la DANG LUU
            # (da decode) cua box, khong phai dang gui. Web vendor (AddChannel.js)
            # dung converChar=encodeURIComponent(rtsp) la DUNG — box nhan '%25'.
            # Chi escape '%' khong di sau 2 ky tu hex (giong _esc_userinfo), khong
            # cham path/query (subtype=1 phai giu nguyen).
            esc = lambda s: re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', s)
            add = {'type': 2, 'channel_name': name, 'rtsp': esc(rtsp),
                   'transport_type': int(req.get('transport_type', 1))}
            if req.get('custom_code'):
                add['custom_code'] = str(req['custom_code'])[:64]
            res = box.call('/api/v2/channel/add', add)
            if res.get('code') == 0:
                res['sync'] = sync_streams()
            return res
        if not req.get('ip'):
            return {'code': 2, 'msg': 'can "rtsp" (type=2) hoac "ip" (type=1 onvif)'}

        k = box.call('/api/v2/rsa/publickey')
        if k.get('code') != 0:
            return {'code': k.get('code'), 'msg': f'rsa/publickey: {k.get("msg")}', 'step': 'rsa'}
        pwd = rsa_encrypt(req.get('pwd', ''), k['data']['public_key'])
        probe = {'ip': req['ip'], 'port': int(req.get('port', 80)),
                 'username': req.get('username', 'admin'), 'pwd': pwd}
        info = box.call('/api/v2/channel/device/info', probe)
        if info.get('code') != 0:
            return {'code': info.get('code'), 'msg': f'device/info: {info.get("msg")}',
                    'step': 'onvif', 'hint': 'code != 0 o day thuong la padding RSA sai'}
        vids = info.get('data', {}).get('video', [])
        add = {'type': 1, 'channel_name': name,
               'video_type': int(req.get('video_type', 1)),
               'transport_type': int(req.get('transport_type', 1)), **probe}
        if add['video_type'] == 2 and vids:
            add['video_id'] = req.get('video_id') or vids[0].get('id')
        res = box.call('/api/v2/channel/add', add)
        if res.get('code') == 0:
            res['sync'] = sync_streams()
        res['streams'] = vids
        return res

    def do_GET(self):
        u = urlparse(self.path)
        if self._local_only(u.path):
            return
        if u.path == '/events':
            return self._sse()
        if u.path == '/aibox/picture':               # anh: GET nguoc ve box
            st, data = box.raw('GET', '/api/v2/smart/picture?' + u.query)
            self.send_response(st)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if u.path == '/aibox/video':                 # clip: GET nguoc ve box
            # Box KHONG day file video ve /alarm — no chi gui video_url dang
            # /api/v2/smart/video?ChlId=6&StartTime=..&EndTime=.. de KEO clip ve
            # theo khoang thoi gian. Query di nguyen xi sang box.
            #
            # PHAI ho tro Range: MP4 cua box co 'moov' o CUOI file (offset ~7.78MB
            # tren 7.79MB). Khong co Range thi browser buoc phai tai het moi doc
            # duoc bang thoi gian -> thanh tien trinh khong keo duoc. Box khong
            # nhan Range nen bridge tu cat: tai het 1 lan roi cache, cac request
            # Range sau lay tu cache.
            key = u.query
            data = _vid_cache.get(key)
            if data is None:
                st, data = box.raw('GET', '/api/v2/smart/video?' + u.query)
                if st != 200 or not data:
                    self.send_response(st or 502)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                _vid_cache[key] = data
                while len(_vid_cache) > 4:       # clip ~8MB/cai, giu toi da 4
                    _vid_cache.pop(next(iter(_vid_cache)))
            total = len(data)
            rng = self.headers.get('Range', '')
            m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    a = int(m.group(1))
                    b = int(m.group(2)) if m.group(2) else total - 1
                else:                            # 'bytes=-N' = N byte cuoi
                    a, b = max(0, total - int(m.group(2))), total - 1
                b = min(b, total - 1)
                if a > b or a >= total:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{total}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                chunk = data[a:b + 1]
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {a}-{b}/{total}')
                self.send_header('Content-Length', str(len(chunk)))
            else:
                chunk = data
                self.send_response(200)
                self.send_header('Content-Length', str(total))
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            return self.wfile.write(chunk)
        if u.path == '/aibox/syscap':                # CHI DOC: CoreCapabilities
            # Legacy API (chu HOA) — web box goi GET /API/V1.0/System/Capabilities.
            # CoreCapabilities = danh sach thuat toan box THAT SU nhan; web UI loc
            # danh sach tick theo no. Thuat toan ngoai list nay -> box bo qua.
            st, data = box.raw('GET', '/API/V1.0/System/Capabilities')
            self.send_response(st)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self._cors(); self.end_headers()
            return self.wfile.write(data)
        if u.path == '/api/conn':
            return self._json({'code': 0, 'data': conn_info()})
        return super().do_GET()

    def translate_path(self, path):
        """/alarms/x.jpg -> ALARM_DIR/x.jpg.

        KHONG duoc gan self.directory = ALARM_DIR trong do_GET: day la state cua
        CONNECTION, va voi HTTP/1.1 keep-alive browser dung lai 1 connection cho moi
        request -> ngay khi popup nap 1 anh tu /alarms/, MOI request sau do tren
        connection do bi phuc vu tu alarms/ (style.css 404, ui.js 404). Chinh viec
        hien anh tu pha trang. translate_path khong luu state nen khong ro ri, va
        ap dung cho ca HEAD (do_GET cu bo qua HEAD -> 404)."""
        p = urlparse(path).path
        if p.startswith('/alarms/'):
            return os.path.join(ALARM_DIR, os.path.basename(unquote(p)))
        # ui/ co cac file backup (.bak, .bak2, .bak-preapple, .pre-area) va chung
        # duoc phuc vu cong khai nhu moi file tinh khac. ui/ui.js.bak chua MOT
        # COMMENT ghi mat khau camera that -> tra ve duong dan khong ton tai de 404.
        # (Da mo LAN o _local_only nen truoc day chi may chu doc duoc, gio thi ca mang.)
        _n = os.path.basename(p).lower()
        if '.bak' in _n or '.pre-' in _n:
            return os.path.join(HERE, '__khong_ton_tai__')
        return super().translate_path(path)

    def _sse(self):
        q = queue.Queue(maxsize=200)
        with _subs_lock:
            _subs.append(q)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self._cors()                 # /events tu browser :5173 -> can ACAO nhu cac route JSON
        self.end_headers()
        try:
            while True:
                try:
                    self.wfile.write(q.get(timeout=20))
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with _subs_lock:
                if q in _subs:
                    _subs.remove(q)


def selftest():
    assert _parse_challenge('Digest qop=auth,realm="R",nonce="123"') == \
        {'qop': 'auth', 'realm': 'R', 'nonce': '123'}, 'challenge khong ngoac kep'
    assert _parse_challenge('Basic realm="x"') is None
    # Digest theo vi du muc 1.4 cua tai lieu. r2 va chain khop chinh xac -> cong thuc
    # dung. (r1 khong tai tao duoc vi mat khau trong PDF bi watermark lam nhieu, khong
    # phai 'admin123' -> kiem chain tu r1 cua tai lieu la du.)
    h = lambda s: hashlib.md5(s.encode()).hexdigest()
    r1, r2 = '98ca67a03cba1d7167bf0096cb957f7d', '305c43426cbcddb71ce670bae226bbc1'
    assert h('POST:/api/v2/algo/list') == r2, 'r2 = md5(METHOD:path)'
    assert h(f'{r1}:1923473498:00000002:1a42d15d190f2f7c93cfe0f749aa4674:auth:{r2}') \
        == 'ebaadf53a48e3156cd5a1485b63658b0', 'response = md5(r1:nonce:nc:cnonce:qop:r2)'
    # parse SEQUENCE{INTEGER n, INTEGER e}: modulus = so lon nhat, exponent = con lai
    assert rsa_pubkey(base64.b64encode(
        bytes([0x30, 0x06, 0x02, 0x01, 0x11, 0x02, 0x01, 0x03])).decode()) == (17, 3)

    # RSA round-trip that su tren key 512-bit sinh boi chinh test (khong can lib):
    # p, q co dinh -> n, d. Encrypt bang rsa_encrypt() roi decrypt bang d, kiem tra
    # padding dung dang 00 02 <>=8 byte khac 0> 00 <message>.
    p = 0xF7E75FDC469067FFDC4E847C51F452DF        # so nguyen to 128-bit
    q = 0xE85CED54AF57E53E092113E62F436F4F
    n, e = p * q, 65537
    d = pow(e, -1, (p - 1) * (q - 1))

    def der_int(v):                                # INTEGER, chen 0x00 neu bit cao = 1
        b = v.to_bytes((v.bit_length() + 8) // 8, 'big')
        return bytes([0x02, len(b)]) + b

    body = der_int(n) + der_int(e)
    der = bytes([0x30, 0x81, len(body)] if len(body) > 127 else [0x30, len(body)]) + body
    ct = rsa_encrypt('Imou123456%', base64.b64encode(der).decode())
    em = pow(int.from_bytes(base64.b64decode(ct), 'big'), d, n).to_bytes(32, 'big')
    assert em[0:2] == b'\x00\x02', em[:4].hex()
    sep = em.index(b'\x00', 2)
    assert sep >= 10, f'padding chi {sep - 2} byte, PKCS#1 doi >= 8'
    assert b'\x00' not in em[2:sep], 'padding chua byte 00'
    assert em[sep + 1:] == b'Imou123456%', em[sep + 1:]

    # ghep credential vao rtsp tran tu /channel/list
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
    # URL da co '@' van phai escape, khong duoc coi la 'nguyen ban roi bo qua'.
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

    # _orphans: moi luong khong co channel tren box la ruong, xoa ca ten khac ch<so>
    assert _orphans(['ch1', 'ch5', 'zz'], [{'channel_id': 1}, {'channel_id': 2}], 100) == ['ch5', 'zz']
    assert _orphans(['ch1', 'ch10'], [{'channel_id': 1}], 1) == []  # list bi cat -> rong
    assert _orphans([], [{'channel_id': 99}], 100) == []
    # '_probe_*' cua testUrl: con sống thoang qua thi dung cham
    assert _orphans(['ch3', 'zz_probe', '_probe_1'], [{'channel_id': 1}], 10) == ['ch3', 'zz_probe']

    # key qua nho cho message -> phai bao loi, khong im lang tao ciphertext rac
    try:
        rsa_encrypt('x' * 40, base64.b64encode(der).decode())
        raise AssertionError('dang le phai raise: message dai hon k-11')
    except ValueError:
        pass

    # parse_discover: nhan response box, tra list camera. AccessProtocolType 3=platform.
    resp_ok = {'status_code': 0, 'data': {
        'DeviceInfoList': [
            {'IP': '192.168.1.100', 'Port': 554, 'Manufacturer': 'Uniview', 'DevID': '', 'AccessProtocolType': 1},
            {'IP': '192.168.1.101', 'Port': 80, 'Manufacturer': 'Dahua', 'DevID': 'ABC123', 'AccessProtocolType': 3},
        ]}}
    devs = parse_discover(resp_ok)
    assert len(devs) == 2, devs
    assert devs[0] == {'ip': '192.168.1.100', 'port': 554, 'manufacturer': 'Uniview', 'addr': '192.168.1.100'}
    assert devs[1] == {'ip': '192.168.1.101', 'port': 80, 'manufacturer': 'Dahua', 'addr': '192.168.1.101(ABC123)'}
    # loi box tra
    assert parse_discover({'status_code': 1}) == []
    assert parse_discover({}) == []

    # /countpeople: sum = tong, chN = tung camera, '' = camera co bat dem nguoi.
    _AREA.clear(); sent = []
    _tg_post_orig = _tg_post
    _box_channels_orig = _box_channels
    _box_area_enabled_orig = _box_area_enabled
    _area_last_orig = _area_last
    def _fake_post(m, c, f): sent.append(f.get('text', ''))
    globals()['_tg_post'] = _fake_post
    globals()['_box_channels'] = lambda: [(1, 'A'), (2, 'B')]   # box co 2 camera
    globals()['_box_area_enabled'] = lambda: {'1', '2'}         # ca 2 deu bat dem
    globals()['_area_last'] = lambda cid: (None, None)          # khong co lich su
    _AREA.update({'1': {'count': 3, 'name': 'A'}, '2': {'count': 5, 'name': 'B'}})
    sent.clear(); _tg_countpeople('sum', '0');    assert '2 camera' in sent[0] and '8' in sent[0], sent
    sent.clear(); _tg_countpeople('ch1', '0');    assert '3' in sent[0] and 'A' in sent[0], sent
    sent.clear(); _tg_countpeople('', '0');       assert '2 camera' in sent[0], sent
    # camera bat dem nhung chua co du lieu trong phien -> lay SO CUOI CUNG tu lich su
    _AREA.clear(); globals()['_area_last'] = lambda cid: (7, 'B') if cid == '2' else (None, None)
    sent.clear(); _tg_countpeople('', '0')
    assert '7 người' in sent[0] and 'B (CH2): 7 người' in sent[0], sent
    # khong ca _AREA lan lich su -> bao ro
    globals()['_area_last'] = lambda cid: (None, None)
    sent.clear(); _tg_countpeople('', '0')
    assert 'chưa có dữ liệu' in sent[0], sent
    sent.clear(); _tg_countpeople('sum', '0');    assert '0' in sent[0], sent
    # khong camera nao bat dem -> bao ro
    globals()['_box_area_enabled'] = lambda: None
    sent.clear(); _tg_countpeople('', '0')
    assert 'Không có camera nào bật đếm người' in sent[0], sent
    assert _tg_handle_command('/countpeople', '0') is True
    assert _tg_handle_command('/countpeople sum', '0') is True
    assert _tg_handle_command('/CountPeople ch2', '0') is True
    assert _tg_handle_command('hello', '0') is False
    globals()['_tg_post'] = _tg_post_orig
    globals()['_box_channels'] = _box_channels_orig
    globals()['_box_area_enabled'] = _box_area_enabled_orig
    globals()['_area_last'] = _area_last_orig
    # SSE: queue day phai VUT tin cu va GIU dang ky client. Huy dang ky thi _sse
    # van ': ping' nen EventSource khong reconnect -> tab Nhat ky dung yen vinh vien.
    q = queue.Queue(maxsize=2)
    _subs.append(q)
    try:
        for i in range(5):
            _publish({'kind': 'alarm', 'i': i})
        assert q in _subs, 'client bi huy dang ky khi queue day'
        assert q.qsize() == 2, q.qsize()
        got = [json.loads(q.get_nowait().decode()[len('data: '):])['i'] for _ in range(2)]
        assert got == [3, 4], f'phai giu 2 tin MOI nhat, duoc {got}'
    finally:
        if q in _subs:
            _subs.remove(q)

    print('selftest ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        selftest()
        raise SystemExit
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(ALARM_DIR, exist_ok=True)
    load_conf()
    if not CONN['host'] or not CONN['pass']:
        print('! Chua co IP/mat khau -> mo tab Cau hinh trong UI de dien')
    print(f'box   http://{CONN["host"] or "(chua dat)"}:{CONN["port"]}   '
          f'ui http://127.0.0.1:{PORT}/')
    print(f'alarm URL de dien vao /docking/config/update: http://<ip-may-nay>:{PORT}/alarm')
    # Bind 0.0.0.0 vi box o IP khac, khong toi duoc 127.0.0.1. Nhung CHI /alarm mo
    # ra LAN — UI, /aibox/*, /api/* deu tu choi request khong tu localhost (xem
    # _lan_allowed). Neu khong, may nao trong LAN cung xoa duoc camera qua proxy nay.
    print(f'alarm URL dien vao box: http://{lan_ip()}:{PORT}/alarm')
    # Doi may/build lai: conf nam trong DATA (= thu muc exe voi ban dong goi). Thieu
    # file nay = khong co IP box, khong co token -> khong nhan alarm, khong quet duoc nhom.
    print(f'conf  {CONF}   '
          f'host={"co" if CONN["host"] else "KHONG"} pass={"co" if CONN["pass"] else "KHONG"} '
          f'tg_token={"co" if CONN["tg_token"] else "KHONG"} nhom={len(CONN.get("tg_chats") or [])}')
    # go2rtc phai song truoc khi UI hien stream, nen watchdog chay ngay tu day.
    threading.Thread(target=go2rtc_watchdog, daemon=True, name='go2rtc').start()
    # Bot lang nghe lenh Telegram (/countpeople...). Chay som de bat lenh ngay khi
    # co token; _tg_poll tu ngu khi chua co token.
    threading.Thread(target=_tg_poll, daemon=True, name='tg-poll').start()
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
