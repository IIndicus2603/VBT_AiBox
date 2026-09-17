#!/usr/bin/env python3
"""Core API router: cameras, algo, alarms, health.

Serves REAL data from the box via app.box.client when the box is reachable /
configured, and MOCK data when env MOCK_DATA=1 (see app.mock). This lets the
React frontend boot and show content offline for UI testing.

NOTE: /api/conn lives in app.api.conn (sibling module); this router keeps only
the read/health endpoints that are not duplicated there. GET variants of
/cameras, /algo/all and /alarms coexist with the POST variants in
app.api.cameras / app.api.algo / app.alarm.routes.
"""
from fastapi import APIRouter

from app import mock
from app.box.client import box

router = APIRouter(prefix='/api')


@router.get('/health')
def health():
    return {'status': 'ok', 'mock': mock.mock_enabled()}


@router.get('/cameras')
def cameras():
    if mock.mock_enabled():
        return {'code': 0, 'data': mock.mock_cameras()}
    try:
        ch = box.call('/api/v2/channel/list',
                      {'page': 1, 'pagesize': 100, 'channel_name': ''})
        if ch.get('code') != 0:
            return ch
        en = box.call('/api/v2/smart/enable/list')
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
        return {'code': 0, 'data': out}
    except Exception as e:
        return {'code': -1, 'msg': f'{type(e).__name__}: {e}'}


@router.get('/algo/all')
def algo_all():
    if mock.mock_enabled():
        return {'code': 0, 'data': mock.mock_algo_all()}
    try:
        sup = box.call('/api/v2/algo/list')
        cur = box.call('/api/v2/algo/list/current')
        hr = box.call('/api/v2/smart/hashinfo/get',
                      {'channel_id': 1, 'algo_model': []})
        return {'code': 0, 'data': {
            'supported': (sup.get('data') or {}).get('algo_model') or [],
            'loaded': (cur.get('data') or {}).get('algo_model') or [],
            'hashrate': (hr.get('data') or {}).get('hashrate'),
            'max': 20}}
    except Exception as e:
        return {'code': -1, 'msg': f'{type(e).__name__}: {e}'}


@router.get('/alarms')
def alarms(include_area: bool = False):
    """History for the Nhat ky tab. In mock mode return generated fake alarms."""
    if mock.mock_enabled():
        evs = mock.mock_alarms(150)
        if not include_area:
            evs = [e for e in evs if e.get('area_num') is None]
        return {'code': 0, 'data': evs}
    # Real mode: read from mongo repo if reachable, else empty.
    try:
        from app.db import repos
        docs = repos.AlarmRepo.tail(1500)
        from app.alarm import normalize
        evs = []
        for a in docs:
            ev = normalize._norm_alarm(a)
            if not include_area and ev.get('area_num') is not None:
                continue
            evs.append(ev)
        return {'code': 0, 'data': evs}
    except Exception:
        return {'code': 0, 'data': []}