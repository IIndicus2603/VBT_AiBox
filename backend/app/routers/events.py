#!/usr/bin/env python3
"""SSE /events router: live alarm timeline.

In mock mode (MOCK_DATA=1) it streams fake alarms from app.mock.mock_events.
Otherwise it subscribes to the real publish fan-out (app.alarm.publish._subs)
exactly like the original aibox.py _sse handler, including the ': ping'
keep-alive every 20s so EventSource stays alive.
"""
import asyncio
import json
import queue

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app import mock
from app.alarm.publish import _subs, _subs_lock

router = APIRouter()


@router.get('/events')
async def events(request: Request):
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