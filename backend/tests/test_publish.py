#!/usr/bin/env python3
"""Tests for the ported alarm publish module.

Ported from aibox.py selftest() (lines 2684-2695): a full SSE queue must DROP the
oldest items and KEEP the client subscription. The subscriber stays registered
so EventSource keeps reconnecting; only the newest 2 items survive.
"""
import json
import queue

from app.alarm import publish


def test_queue_drops_oldest_keeps_subscription():
    q = queue.Queue(maxsize=2)
    publish._subs.append(q)
    try:
        for i in range(5):
            publish._publish({'kind': 'alarm', 'i': i})
        assert q in publish._subs, 'client bi huy dang ky khi queue day'
        assert q.qsize() == 2, q.qsize()
        got = [json.loads(q.get_nowait().decode()[len('data: '):])['i']
               for _ in range(2)]
        assert got == [3, 4], f'phai giu 2 tin MOI nhat, duoc {got}'
    finally:
        if q in publish._subs:
            publish._subs.remove(q)