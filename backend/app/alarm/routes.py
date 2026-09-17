#!/usr/bin/env python3
"""Alarm router (port of aibox.py do_POST /alarm, /api/alarms, /aibox/dao/delete +
do_GET /events, /aibox/picture, /aibox/video, /aibox/export/*).

Routes:
  POST /alarm               -> box pushes alarms here (multipart OR JSON). Ack
                               {code:200,msg:ok}. Parse ?slot= / ?platform=.
  POST /api/alarms          -> alarm history for the Nhat ky tab.
  GET  /events              -> SSE live timeline (heartbeat + drop-old).
  GET  /aibox/picture       -> GET box image.
  GET  /aibox/video         -> GET box video clip + Range support + _vid_cache(4).
  GET  /aibox/export/progress -> export batch progress + rewritten file URL.
  GET  /aibox/export/file   -> download export file via box.download.
  DELETE /aibox/dao/delete  -> delete alarm records on the box.
"""
import asyncio
import json
import queue
import re
from urllib.parse import parse_qs, urlencode, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from app import config
from app import mock
from app.alarm.normalize import _norm_alarm
from app.alarm.publish import _subs, _subs_lock
from app.alarm.receiver import handle_alarm
from app.box.client import box
from app.db import repos

router = APIRouter()

# query -> bytes clip da tai, de phuc vu Range (box khong nhan Range). Toi da 4.
_vid_cache = {}


@router.post('/alarm')
async def alarm_ingress(request: Request, slot: int = None, platform: int = None):
    """Box POST /alarm?slot=N (hoac ?platform=N). Dispatch multipart OR JSON by
    content-type. Ack {code:200,msg:ok} so box ngu coi la da nhan."""
    body = await request.body()
    ctype = request.headers.get('content-type') or ''
    _sl = slot if slot is not None else platform
    handle_alarm(body, ctype, _sl)
    return {'code': 200, 'msg': 'ok'}


@router.post('/api/alarms')
async def alarms(request: Request):
    """Alarm history for the Nhat ky tab. In MOCK_DATA use mock_alarms."""
    try:
        req = await request.json()
    except Exception:
        req = {}
    _incl_area = bool(req.get('include_area'))
    if mock.mock_enabled():
        evs = mock.mock_alarms(150)
        if not _incl_area:
            evs = [e for e in evs if e.get('area_num') is None]
        return {'code': 0, 'data': evs}
    try:
        docs = repos.AlarmRepo.tail(1500)
    except Exception:
        docs = []
    out = []
    for a in docs:
        ob = a.get('behaviour') or a.get('face') or {}
        if a.get('type') in (2, 6, 7):
            continue
        if ob.get('algo_model') == 'AreaRuleData':
            if not _incl_area:
                continue
            ev = {**_norm_alarm(a), '_is_area': True}
        else:
            ev = _norm_alarm(a)
        ev['seen'] = a.get('seen', False)      # đánh dấu "cảnh báo mới" (badge/MỚI)
        out.append(ev)
        if len(out) >= 300:
            break
    return {'code': 0, 'data': out}


@router.get('/api/alarms/unread-count')
async def alarms_unread_count():
    """Số cảnh báo chưa đọc (seen=false) — badge "cảnh báo mới" toàn app."""
    try:
        n = repos.AlarmRepo.unread_count()
    except Exception:
        n = 0
    return {'code': 0, 'count': n}


@router.post('/api/alarms/read')
async def alarms_read(request: Request):
    """Đánh dấu đã đọc. body {} = tất cả; body {event_id: [...]} = danh sách id."""
    try:
        req = await request.json()
    except Exception:
        req = {}
    ids = req.get('event_id')
    try:
        n = repos.AlarmRepo.mark_read(event_ids=ids, all_=not ids)
    except Exception:
        n = 0
    return {'code': 0, 'marked': n, 'count': repos.AlarmRepo.unread_count()}


@router.get('/events')
async def events(request: Request):
    """SSE live timeline. In MOCK_DATA stream fake events; else subscribe to the
    publish fan-out with ': ping' keep-alive every 20s (port of aibox.py _sse)."""
    if mock.mock_enabled():
        async def gen():
            try:
                async for ev in mock.mock_events():
                    if await request.is_disconnected():
                        break
                    yield f'data: {json.dumps(ev, ensure_ascii=False)}\n\n'
            except (asyncio.CancelledError, GeneratorExit):
                pass
        return StreamingResponse(gen(), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache'})

    q = queue.Queue(maxsize=200)
    with _subs_lock:
        _subs.append(q)

    async def gen():
        try:
            loop = asyncio.get_running_loop()
            while True:
                try:
                    line = await loop.run_in_executor(None, q.get, True, 20)
                    yield line.decode()
                except queue.Empty:
                    yield ': ping\n\n'
        except (asyncio.CancelledError, GeneratorExit, RuntimeError):
            pass
        finally:
            with _subs_lock:
                if q in _subs:
                    _subs.remove(q)

    return StreamingResponse(gen(), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache'})


@router.get('/aibox/picture')
async def aibox_picture(request: Request):
    st, data = box.raw('GET', '/api/v2/smart/picture?' + request.url.query)
    return Response(content=data, status_code=st, media_type='image/jpeg')


@router.get('/aibox/video')
async def aibox_video(request: Request):
    """GET box video clip. Box does not accept Range, so we pull it once and cache,
    serving subsequent Range requests from the cache. Max 4 clips cached."""
    global _vid_cache
    key = request.url.query
    data = _vid_cache.get(key)
    if data is None:
        st, data = box.raw('GET', '/api/v2/smart/video?' + key)
        if st != 200 or not data:
            return Response(status_code=st or 502, content=b'')
        _vid_cache[key] = data
        while len(_vid_cache) > 4:
            _vid_cache.pop(next(iter(_vid_cache)))
    total = len(data)
    rng = request.headers.get('range', '')
    m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
    if m and (m.group(1) or m.group(2)):
        if m.group(1):
            a = int(m.group(1))
            b = int(m.group(2)) if m.group(2) else total - 1
        else:
            a, b = max(0, total - int(m.group(2))), total - 1
        b = min(b, total - 1)
        if a > b or a >= total:
            return Response(status_code=416, content=b'',
                            headers={'Content-Range': f'bytes */{total}',
                                     'Accept-Ranges': 'bytes'})
        chunk = data[a:b + 1]
        return Response(content=chunk, status_code=206, media_type='video/mp4',
                        headers={'Content-Range': f'bytes {a}-{b}/{total}',
                                 'Accept-Ranges': 'bytes'})
    return Response(content=data, status_code=200, media_type='video/mp4',
                    headers={'Accept-Ranges': 'bytes'})


@router.get('/aibox/export/progress')
async def aibox_export_progress():
    st, data = box.raw('GET', '/API/V1.0/Smart/DaoRecord/Search/BatchProgress')
    try:
        r = json.loads(data or b'{}')
        if r.get('data', {}).get('URL'):
            r['data']['URL'] = '/aibox/export/file?' + urlencode({'u': r['data']['URL']})
        data = json.dumps(r, ensure_ascii=False).encode()
    except (json.JSONDecodeError, AttributeError):
        pass
    return Response(content=data, status_code=st, media_type='application/json')


@router.get('/aibox/export/file')
async def aibox_export_file(request: Request):
    url = parse_qs(request.url.query).get('u', [''])[0]
    pu = urlparse(url)
    if not pu.path:
        return {'code': -1, 'msg': 'thieu u'}
    p = pu.path + (('?' + pu.query) if pu.query else '')
    st, data = box.download(p)
    return Response(content=data, status_code=st)


@router.delete('/aibox/dao/delete')
async def aibox_dao_delete(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    st, data = box.raw('DELETE', '/API/V1.0/Smart/DaoRecord/Delete', body)
    try:
        r = json.loads(data or b'{}')
    except json.JSONDecodeError:
        return {'code': -1, 'msg': f'HTTP {st}: {data[:200]!r}'}
    return r