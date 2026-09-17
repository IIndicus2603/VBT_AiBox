#!/usr/bin/env python3
"""Boot tests for the FastAPI entrypoint.

Verifies the app boots (even with mongo unreachable) and serves /api/health and
/api/conn. Runs in MOCK_DATA=1 mode so no box / go2rtc watchdog is needed."""
import os

import pytest

os.environ['MOCK_DATA'] = '1'          # hermetic: no box, no watchdog thread

from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def _mock_env():
    """Pin MOCK_DATA=1 for every test in this module, independent of the order
    other test modules run (test_mock pops the env var in one of its tests)."""
    os.environ['MOCK_DATA'] = '1'
    yield
    os.environ['MOCK_DATA'] = '1'


def test_health_ok():
    with TestClient(app) as c:
        r = c.get('/api/health')
        assert r.status_code == 200
        assert r.json()['status'] == 'ok'


def test_conn_code_zero():
    with TestClient(app) as c:
        r = c.get('/api/conn')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert 'data' in body


def test_cameras_mock_shape():
    with TestClient(app) as c:
        r = c.get('/api/cameras')
        assert r.status_code == 200
        body = r.json()
        assert body['code'] == 0
        assert len(body['data']) >= 4


def test_algo_all_mock():
    with TestClient(app) as c:
        r = c.get('/api/algo/all')
        assert r.status_code == 200
        assert r.json()['code'] == 0
        assert r.json()['data']['max'] == 20