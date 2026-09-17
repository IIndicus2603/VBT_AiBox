#!/usr/bin/env python3
"""MOCK DATA layer for offline UI testing.

When env MOCK_DATA=1 is set, the FastAPI bridge serves realistic fake data so the
React frontend shows content without a live box. All alarm/camera/algo names use
REAL Vietnamese labels imported from app.alarm.normalize (ALGO_VI). Fully
self-contained — no box / mongo calls.
"""
import os
import time

from app.alarm.normalize import ALGO_VI

# Real algo models drawn from ALGO_VI (the technical codes, not the Vietnamese
# labels). Picked the ones the app cares about most (safety/attire/fire).
_MOCK_ALGOS = [
    'SafetyHelmetAlarm', 'WorkClothesAlarm', 'SmokingAlarm',
    'TelephoningAlarm', 'FallOverAlarm', 'FireDetection',
    'EnterArea', 'LeaveArea', 'LineDetectorCrossed',
    'FightDetectionAlarm',
]

# (model, ipc_addr) pool cycled by mock_alarms / mock_events so the live
# timeline feels like real cameras firing different algo over time.
_MOCK_CAMS = [
    {'channel_id': 1, 'name': 'Cổng chính', 'ip': '192.168.21.21'},
    {'channel_id': 2, 'name': 'Nhà xưởng A', 'ip': '192.168.21.22'},
    {'channel_id': 3, 'name': 'Nhà xưởng B', 'ip': '192.168.21.23'},
    {'channel_id': 4, 'name': 'Kho hàng', 'ip': '192.168.21.24'},
    {'channel_id': 5, 'name': 'Bãi đỗ xe', 'ip': '192.168.21.25'},
    {'channel_id': 6, 'name': 'Văn phòng', 'ip': '192.168.21.26'},
]

_TYPES = {1: 'behavior', 2: 'reset', 3: 'face', 4: 'facematch',
          5: 'behavior+match', 6: 'keepalive', 7: 'channel'}


def mock_enabled() -> bool:
    """True when the offline mock layer should be used (env MOCK_DATA=1)."""
    return os.environ.get('MOCK_DATA') == '1'


def mock_cameras():
    """Fake camera list matching /api/cameras output shape."""
    out = []
    for c in _MOCK_CAMS:
        cid = c['channel_id']
        out.append({
            'channel_id': cid,
            'name': c['name'],
            'ip': c['ip'],
            'status': 1,
            'model': 'IPC322LB3F' + str(cid),
            'stream': f'ch{cid}',
            'ai_on': 1,
            'algos': [_MOCK_ALGOS[cid % len(_MOCK_ALGOS)]],
            'rtsp': f'rtsp://admin:mock@{c["ip"]}:554/cam/realmonitor?channel={cid}&subtype=1',
            'username': 'admin',
            'transport_type': 'rtsp',
            'custom_code': '',
        })
    return out


def _mock_event(cid, algo_model, ts):
    """One fake normalized alarm matching _norm_alarm output (see normalize.py).
    Uses a real ALGO_VI code so the label renders in Vietnamese."""
    cam = next(c for c in _MOCK_CAMS if c['channel_id'] == cid)
    t = 1 if algo_model != 'FaceRecognitionAlarm' else 4
    return {
        'kind': 'alarm',
        'ts': ts,
        'type': t,
        'label': _TYPES.get(t, str(t)),
        'channel_id': cid,
        'channel_name': cam['name'],
        'ipc_addr': cam['ip'],
        'event_id': f'mock-{cid}-{ts}',
        'algo_model': algo_model,
        'capture_info': [{'object_type': 'person', 'target_id': ts % 7}],
        'person': None,
        'area_num': None,
        'video_url': f'/aibox/video?ChlId={cid}&StartTime={ts - 10}&EndTime={ts}',
        'video_uuid': None,
        'platform': 1,
        'images': [],
    }


def mock_alarms(n=30):
    """List of n fake normalized alarm events, newest first, with realistic
    timestamps spread over the last few minutes."""
    now = int(time.time())
    out = []
    for i in range(n):
        ts = now - i * 17                      # ~17s apart -> realistic spread
        cid = _MOCK_CAMS[i % len(_MOCK_CAMS)]['channel_id']
        algo = _MOCK_ALGOS[(i + cid) % len(_MOCK_ALGOS)]
        out.append(_mock_event(cid, algo, ts))
    return out


def mock_algo_all():
    """Fake /api/algo/all: a real-ish supported list, nothing loaded, no load."""
    return {'supported': list(_MOCK_ALGOS), 'loaded': [], 'hashrate': None,
            'max': 20}


def mock_conn_info():
    """Fake /api/conn GET body (no password, just has_pass flag)."""
    return {'host': '192.168.21.93', 'port': 80, 'user': 'admin', 'has_pass': True,
            'lan_ip': '192.168.21.93', 'bridge_port': 8090, 'has_tg': False,
            'tg_setup_n': 0, 'tg_chats': []}


def mock_conn_test():
    """Fake /api/conn/test body — device info the header shows as the box name.
    Matches what box /api/v2/device/get returns (device_name/model/device_sn)."""
    return {'device_name': 'UNV SmartBox', 'model': 'IPC322', 'device_sn': 'MOCK-DEMO'}


async def mock_events():
    """Async generator yielding fake SSE event dicts every ~5s so the live
    timeline keeps updating in offline mode. Cycles through cameras and algos."""
    n = 0
    while True:
        cam = _MOCK_CAMS[n % len(_MOCK_CAMS)]
        algo = _MOCK_ALGOS[(n + cam['channel_id']) % len(_MOCK_ALGOS)]
        yield _mock_event(cam['channel_id'], algo, int(time.time()))
        n += 1
        await _mock_sleep(5.0)


async def _mock_sleep(secs):
    # tiny wrapper so the sleep is cancellable / easy to patch in tests
    import asyncio
    await asyncio.sleep(secs)