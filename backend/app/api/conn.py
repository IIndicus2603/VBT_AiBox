#!/usr/bin/env python3
"""Connection / Telegram config router (port of aibox.py do_POST /api/conn* +
_docking_info/_docking_register + conn_info).

Routes:
  GET  /api/conn            -> conn_info() (or mock_conn_info in MOCK_DATA)
  POST /api/conn            -> save host/port/user/pass, reset box challenge,
                               persist via repos.ConfigRepo, _docking_register
  POST /api/conn/tgsave     -> save tg_token + tg_chats
  POST /api/conn/test       -> box.call /api/v2/device/get
  POST /api/conn/docking    -> _docking_register(slot)
  GET  /api/conn/docking/info -> _docking_info()
  POST /api/conn/tgtest     -> _tg_post test message to each selected chat
"""
import json
import re
import socket

from fastapi import APIRouter, Request

from app import config
from app import mock
from app.box.client import box
from app.db import repos
from app.telegram.send import _tg_post

router = APIRouter(prefix='/api')

_PORT_RE = re.compile(r'^[A-Za-z0-9._\-]{1,253}$')


def lan_ip():
    """IP cua may nay ma BOX toi duoc (port from aibox.py lan_ip)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((config.CONN['host'] or '8.8.8.8', config.CONN['port'] or 80))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def conn_info():
    """Trang thai ket noi cho UI (port from aibox.py conn_info)."""
    c = config.CONN
    return {'host': c['host'], 'port': c['port'], 'user': c['user'],
            'has_pass': bool(c['pass']), 'lan_ip': lan_ip(), 'bridge_port': config.PORT,
            'has_tg': bool(c['tg_token'] and c.get('tg_setup')),
            'tg_setup_n': len(c.get('tg_setup') or {}),
            'tg_chats': c.get('tg_chats') or []}


def _docking_info():
    """Doc platform 1|2 trong box (port from aibox.py _docking_info)."""
    out = {'ok': False, 'err': '', 'slots': []}
    if not config.CONN['host'] or not config.CONN['pass']:
        out['err'] = 'Chua dien IP/mat khau box (tab Cau hinh)'
        return out
    try:
        r = box.call('/api/v2/docking/config/get', {})
        if r.get('code') != 0:
            out['err'] = r.get('msg') or f'box loi code {r.get("code")}'
            return out
        plats = [p for p in (r.get('data') or {}).get('platform') or []
                 if isinstance(p, dict)]
        by_id = {p.get('id'): p for p in plats}
        for sid in (1, 2):
            p = by_id.get(sid)
            if not p:
                out['slots'].append({'slot': sid, 'enabled': 0, 'url': '', 'owner': ''})
                continue
            url = p.get('url') or ''
            owner = url.replace('/alarm', '').split('//')[-1] if url else ''
            out['slots'].append({'slot': sid, 'enabled': p.get('enabled', 0),
                                 'url': url, 'owner': owner})
        out['ok'] = True
    except Exception as e:
        out['err'] = str(e)
    return out


def _docking_register(slot):
    """Tu dang ky alarm URL cua may nay vao box (port from aibox.py). Tra (ok,msg,url)."""
    if not config.CONN['host'] or not config.CONN['pass']:
        return False, 'Chua dien IP/mat khau box (tab Cau hinh)', ''
    url = f'http://{lan_ip()}:{config.PORT}/alarm?slot={slot}'
    try:
        r = box.call('/api/v2/docking/config/get', {})
        if r.get('code') != 0:
            return False, r.get('msg') or f'box loi code {r.get("code")}', ''
        d = r.get('data') or {}
        time_conf = d.get('time_conf') or []
        plats = [p for p in (d.get('platform') or []) if isinstance(p, dict)]
        one = next((p for p in plats if p.get('id') == slot), None)
        if one is None:
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


@router.get('/conn')
def conn_get():
    if mock.mock_enabled():
        return {'code': 0, 'data': mock.mock_conn_info()}
    return {'code': 0, 'data': conn_info()}


@router.post('/conn')
async def conn_save(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    host = str(req.get('host', '')).strip()
    if not _PORT_RE.match(host):
        return {'code': 2, 'msg': 'IP/hostname khong hop le'}
    config.CONN['host'] = host
    config.CONN['port'] = max(1, min(65535, int(req.get('port') or 80)))
    config.CONN['user'] = str(req.get('user', '')).strip() or 'admin'
    if req.get('pass'):
        config.CONN['pass'] = str(req['pass'])
    box.chal, box.nc = None, 0
    try:
        repos.ConfigRepo.save(config.CONN)
    except Exception:
        pass
    dk_slot = int(req.get('slot') or 1)
    dk_ok, dk_err, dk_url = _docking_register(dk_slot) if (config.CONN['host'] and config.CONN['pass']) \
        else (False, 'chua co IP/mat khau', '')
    info = conn_info()
    info['docking'] = {'slot': dk_slot, 'ok': dk_ok, 'err': dk_err, 'url': dk_url}
    return {'code': 0, 'msg': 'Da luu', 'data': info}


@router.post('/conn/tgsave')
async def conn_tgsave(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    if str(req.get('tg_token', '')).strip():
        config.CONN['tg_token'] = str(req['tg_token']).strip()
    if 'tg_chats' in req:
        raw = req.get('tg_chats') or []
        if isinstance(raw, (list, tuple)):
            config.CONN['tg_chats'] = [str(c).strip() for c in raw if str(c).strip()]
    try:
        repos.ConfigRepo.save(config.CONN)
    except Exception:
        pass
    return {'code': 0, 'msg': 'Da luu', 'data': conn_info()}


@router.post('/conn/test')
async def conn_test():
    if mock.mock_enabled():
        return {'code': 0, 'msg': 'ok', 'data': mock.mock_conn_test()}
    try:
        r = box.call('/api/v2/device/get')
    except Exception as e:
        return {'code': -1, 'msg': f'{type(e).__name__}: {e}'}
    return {'code': r.get('code'), 'msg': r.get('msg'), 'data': r.get('data', {})}


@router.post('/conn/docking')
async def conn_docking(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    slot = int(req.get('slot') or 1)
    ok, err, url = _docking_register(slot)
    return {'code': 0 if ok else 1,
            'msg': err or f'Đã đăng ký alarm → platform {slot}',
            'data': {'url': url, 'slot': slot}}


@router.get('/conn/docking/info')
async def conn_docking_info():
    return {'code': 0, 'msg': 'ok', 'data': _docking_info()}


@router.post('/conn/tgtest')
async def conn_tgtest():
    chats = config.CONN.get('tg_chats') or []
    if not (config.CONN.get('tg_token') and chats):
        return {'code': 3, 'msg': 'Chua dien bot token hoac chua tick nhom nao'}
    fails = []
    for c in chats:
        ok, err = _tg_post('sendMessage', c, {'text': '✅ Vibotics SmartBox — test Telegram OK'})
        if not ok:
            fails.append(f'{c}: {err}')
    if fails:
        return {'code': 4, 'msg': '; '.join(fails)}
    return {'code': 0, 'msg': f'Đã gửi tới {len(chats)} nhóm — mở Telegram để xem'}