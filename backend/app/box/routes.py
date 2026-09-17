#!/usr/bin/env python3
"""Box proxy + channel/PTZ router (port of aibox.py do_POST /aibox, /api/channel*,
/api/discover*, /api/sync, /api/ptz + _add_channel/_update_channel/parse_discover).

Routes:
  POST /aibox/{path}          -> box.call('/api/v2/' + path, body)
  GET  /aibox/syscap          -> box.raw GET /API/V1.0/System/Capabilities
  POST /api/channel/add       -> _add_channel (RSA + onvif + escape %25)
  POST /api/channel/update    -> _update_channel
  POST /api/channel/delete    -> box.call /api/v2/channel/delete
  POST /api/discover          -> PUT /API/V1.0/System/DiscoverDevice
  POST /api/discover/list     -> GET /API/V1.1/System/DiscoverDevice + parse_discover
  POST /api/sync              -> sync_streams()
  POST /api/ptz               -> _ptz_cmd(src, cmd, **kw)
"""
import json
import re

from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.box.client import box
from app.box.go2rtc import sync_streams
from app.box.onvif import _ptz_cmd
from app.box.rsa import rsa_encrypt

router = APIRouter()


def parse_discover(resp):
    """Parse DiscoverDevice -> [{ip,port,manufacturer,addr}, ...] (aibox.py:224)."""
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


def _esc_pct(s):
    """Escape '%' not followed by 2 hex chars -> '%25' (box percent-decodes)."""
    return re.sub(r'%(?![0-9A-Fa-f]{2})', '%25', s)


def _add_channel(req):
    """Add a channel: type=2 direct RTSP, or type=1 onvif with RSA pwd (aibox.py:2291)."""
    name = (req.get('channel_name') or '').strip()
    if not name or not name.strip():
        return {'code': 2, 'msg': 'channel_name: bat buoc, khong duoc chi toan khoang trang'}
    if len(name) > 64:
        return {'code': 2, 'msg': 'channel_name: toi da 64 ky tu'}
    rtsp = (req.get('rtsp') or '').strip()
    if rtsp:
        if len(rtsp.encode('utf-8')) > 1023:
            return {'code': 2, 'msg': 'rtsp: toi da 1023 byte UTF-8'}
        if len(rtsp) > 256:
            return {'code': 2, 'msg': 'rtsp toi da 256 ky tu'}
        add = {'type': 2, 'channel_name': name, 'rtsp': _esc_pct(rtsp),
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


def _update_channel(req):
    """Update a direct RTSP channel without exposing/requiring its password (aibox.py:2273)."""
    cid = req.get('channel_id')
    name = (req.get('channel_name') or '').strip()
    rtsp = (req.get('rtsp') or '').strip()
    if not isinstance(cid, int) or cid < 1:
        return {'code': 2, 'msg': 'channel_id: bắt buộc'}
    if not name or len(name) > 64:
        return {'code': 2, 'msg': 'channel_name: bắt buộc và tối đa 64 ký tự'}
    if not rtsp or len(rtsp.encode('utf-8')) > 1023 or len(rtsp) > 256:
        return {'code': 2, 'msg': 'rtsp: bắt buộc và tối đa 256 ký tự'}
    body = {'channel_id': cid, 'channel_name': name, 'type': 2,
            'rtsp': _esc_pct(rtsp), 'transport_type': int(req.get('transport_type') or 1)}
    if req.get('custom_code') is not None:
        body['custom_code'] = str(req['custom_code'])[:64]
    return box.call('/api/v2/channel/update', body)


@router.post('/aibox/{path:path}')
async def aibox_proxy(path: str, request: Request):
    """Generic proxy: POST /aibox/<rest> -> box.call('/api/v2/' + rest, body)."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    return box.call('/api/v2/' + path, body)


@router.get('/aibox/syscap')
async def aibox_syscap():
    st, data = box.raw('GET', '/API/V1.0/System/Capabilities')
    return Response(content=data, status_code=st, media_type='application/json')


@router.post('/api/channel/add')
async def channel_add(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    return _add_channel(req)


@router.post('/api/channel/update')
async def channel_update(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    return _update_channel(req)


@router.post('/api/channel/delete')
async def channel_delete(request: Request):
    try:
        req = await request.json()
    except Exception:
        req = {}
    return box.call('/api/v2/channel/delete', req)


@router.post('/api/discover')
async def discover():
    status, data = box.raw('PUT', '/API/V1.0/System/DiscoverDevice')
    try:
        return json.loads(data or b'{}')
    except json.JSONDecodeError:
        return {'code': -1, 'msg': f'HTTP {status}: {data[:200]!r}'}


@router.post('/api/discover/list')
async def discover_list():
    status, data = box.raw('GET', '/API/V1.1/System/DiscoverDevice')
    try:
        raw = json.loads(data or b'{}')
    except json.JSONDecodeError:
        return {'code': -1, 'msg': f'HTTP {status}: {data[:200]!r}'}
    if raw.get('status_code') != 0:
        return {'code': raw.get('status_code', -1), 'msg': raw.get('msg', 'Discover failed')}
    return {'code': 0, 'data': parse_discover(raw)}


@router.post('/api/sync')
async def sync():
    return sync_streams()


@router.post('/api/ptz')
async def ptz(request: Request):
    try:
        q = await request.json()
    except Exception:
        q = {}
    src, cmd = q.get('src'), q.get('cmd')
    if not src or cmd not in ('move', 'stop', 'home', 'set_home', 'has_home'):
        return {'code': -1, 'msg': 'can src + cmd (move|stop|home|set_home|has_home)'}
    kw = {}
    if cmd == 'move':
        for k in ('pan', 'tilt', 'zoom'):
            v = q.get(k)
            if v is not None:
                try:
                    kw[k] = float(v)
                except (TypeError, ValueError):
                    pass
    return _ptz_cmd(src, cmd, **kw)