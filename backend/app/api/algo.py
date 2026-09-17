#!/usr/bin/env python3
"""Algo / hashrate router (port of aibox.py do_POST /api/algo/* + /api/hashrate).

Routes:
  POST /api/algo/all    -> supported / loaded / hashrate (or mock_algo_all)
  POST /api/algo/save   -> load algo set for the box (capabilities + clear_flag)
  POST /api/hashrate    -> hashrate for one algo set on one channel
"""
from fastapi import APIRouter, Request

from app import mock
from app.box.client import box

router = APIRouter(prefix='/api')


@router.post('/algo/all')
async def algo_all():
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
            'max': 20,
        }}
    except Exception as e:
        return {'code': -1, 'msg': f'{type(e).__name__}: {e}'}


@router.post('/algo/save')
async def algo_save(request: Request):
    try:
        q = await request.json()
    except Exception:
        q = {}
    models = q.get('algo_model') or []
    if not isinstance(models, list) or not all(isinstance(m, str) for m in models):
        return {'code': 2, 'msg': 'algo_model phai la mang chuoi'}
    if len(models) > 20:
        return {'code': 2, 'msg': f'Toi da 20 thuat toan, dang gui {len(models)}'}
    r = box.call('/api/v2/algo/capabilities',
                 {'config': [{'algo_model': m} for m in models],
                  'clear_flag': 1 if q.get('clear') else 0})
    if r.get('code') == 0:
        return {'code': 0, 'data': r.get('data'),
                'msg': f'Da nap {len(models)} thuat toan'}
    return {'code': r.get('code'), 'msg': r.get('msg'),
            'status_code': r.get('status_code')}


@router.post('/hashrate')
async def hashrate(request: Request):
    try:
        q = await request.json()
    except Exception:
        q = {}
    return box.call('/api/v2/smart/hashinfo/get', {
        'channel_id': int(q.get('channel_id') or 1),
        'algo_model': q.get('algo_model') or []})