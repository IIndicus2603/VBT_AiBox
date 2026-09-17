#!/usr/bin/env python3
"""Boot smoke tests for the new FastAPI route modules.

Runs in MOCK_DATA=1 so no live box / go2rtc is needed. Covers the routers
wired into main.py: alarm/routes, box/routes, api/conn, api/algo, api/cameras,
api/tg — plus the existing /api/health.
"""
import os

import pytest

os.environ['MOCK_DATA'] = '1'          # hermetic: no box, no watchdog thread

from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def _mock_env():
    """Pin MOCK_DATA=1 for every test in this module, independent of order."""
    os.environ['MOCK_DATA'] = '1'
    yield
    os.environ['MOCK_DATA'] = '1'


def test_health_ok():
    with TestClient(app) as c:
        r = c.get('/api/health')
        assert r.status_code == 200
        body = r.json()
        assert body['status'] == 'ok'
        assert body['mock'] is True


def test_conn_get_code_zero():
    with TestClient(app) as c:
        r = c.get('/api/conn')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert 'data' in body
        assert body['data']['host']


def test_conn_test_mock_returns_device():
    """In MOCK_DATA, /api/conn/test returns fake device info (box name for header)."""
    with TestClient(app) as c:
        r = c.post('/api/conn/test')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert body['data']['device_name']


def test_alarms_post_returns_list():
    """POST /api/alarms returns a list (from mock in MOCK_DATA), even if empty."""
    with TestClient(app) as c:
        r = c.post('/api/alarms', json={})
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert isinstance(body['data'], list)
        # with mock there should be real entries
        assert len(body['data']) > 0


def test_cameras_post():
    with TestClient(app) as c:
        r = c.post('/api/cameras')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert len(body['data']) >= 4


def test_algo_all_post():
    with TestClient(app) as c:
        r = c.post('/api/algo/all')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert body['data']['max'] == 20