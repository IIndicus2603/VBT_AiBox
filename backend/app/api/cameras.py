#!/usr/bin/env python3
"""Cameras router (port of aibox.py do_POST /api/cameras).

Returns the merged channel/list + smart/enable/list result, or mock_cameras()
when MOCK_DATA=1 so the UI works with no live box.
"""
from fastapi import APIRouter

from app import mock
from app.box.client import box

router = APIRouter(prefix='/api')


@router.post('/cameras')
async def cameras():
    if mock.mock_enabled():
        return {'code': 0, 'data': mock.mock_cameras()}
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