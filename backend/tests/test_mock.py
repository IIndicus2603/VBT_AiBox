#!/usr/bin/env python3
"""Tests for the mock data layer (app.mock)."""
from app import mock
from app.alarm.normalize import ALGO_VI

_KEYS = ['channel_id', 'name', 'ip', 'status', 'model', 'stream', 'ai_on',
         'algos', 'rtsp', 'username', 'transport_type', 'custom_code']


def test_mock_enabled_off_by_default():
    import os
    had = os.environ.get('MOCK_DATA')
    try:
        os.environ.pop('MOCK_DATA', None)
        assert mock.mock_enabled() is False
        os.environ['MOCK_DATA'] = '1'
        assert mock.mock_enabled() is True
    finally:
        if had is None:
            os.environ.pop('MOCK_DATA', None)
        else:
            os.environ['MOCK_DATA'] = had


def test_cameras_has_at_least_4_and_required_keys():
    cams = mock.mock_cameras()
    assert len(cams) >= 4
    for c in cams:
        for k in _KEYS:
            assert k in c, f'thieu key {k}'


def test_alarms_exactly_n_with_valid_algo_model():
    n = 30
    evs = mock.mock_alarms(n)
    assert len(evs) == n
    for e in evs:
        assert e['algo_model'] in ALGO_VI, f'algo khong hop le: {e["algo_model"]}'
        assert e['kind'] == 'alarm'
        assert e['channel_id'] is not None
        assert e['ts'] > 0


def test_conn_info_shape():
    info = mock.mock_conn_info()
    assert info['has_pass'] is True
    assert info['bridge_port'] == 8090
    assert 'host' in info and 'user' in info


def test_algo_all_shape():
    a = mock.mock_algo_all()
    assert isinstance(a['supported'], list) and len(a['supported']) >= 4
    assert a['max'] == 20
    assert a['loaded'] == []