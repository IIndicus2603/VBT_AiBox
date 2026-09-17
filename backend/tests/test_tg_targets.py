#!/usr/bin/env python3
"""Tests for _tg_targets: filters target chats by tg_setup mode (all/rule) + platform.

Ported verbatim from aibox.py:1376-1400: 'all' = gui het (tru khi setup chi dinh
platform ma alarm khong khop); 'rule' = che do c27 chi gui khi rule_send va co ev.
Khong co ev (vd _tg_send_all) thi chi loc qua nhom mode 'all', khong kiem platform.
"""
import pytest

from app import config
from app.telegram.send import _tg_targets


@pytest.fixture(autouse=True)
def _cleanup(monkeypatch):
    monkeypatch.setitem(config.CONN, 'tg_setup', {})
    yield


def test_all_mode_no_platform_sends_all():
    config.CONN['tg_setup'] = {'111': {'mode': 'all', 'name': 'all', 'platform': None}}
    assert _tg_targets({'platform': 1}) == ['111']


def test_all_mode_platform_mismatch_excluded():
    config.CONN['tg_setup'] = {'111': {'mode': 'all', 'name': 'all', 'platform': 1}}
    assert _tg_targets({'platform': 2}) == []


def test_all_mode_platform_match_included():
    config.CONN['tg_setup'] = {'111': {'mode': 'all', 'name': 'all', 'platform': 1}}
    assert _tg_targets({'platform': 1}) == ['111']


def test_all_mode_no_ev_ignores_platform():
    # _tg_send_all goi _tg_targets() khong co ev -> khong kiem platform, gui het all.
    config.CONN['tg_setup'] = {'111': {'mode': 'all', 'name': 'all', 'platform': 1}}
    assert _tg_targets() == ['111']


def test_rule_mode_requires_rule_send_and_ev():
    config.CONN['tg_setup'] = {'222': {'mode': 'rule', 'name': 'c27', 'platform': None}}
    assert _tg_targets({'platform': 1}, rule_send=False) == []
    assert _tg_targets({'platform': 1}, rule_send=True) == ['222']
    # Khong co ev: rule khong lot qua (ev None -> dieu kien ev is not None sai).
    assert _tg_targets(None, rule_send=True) == []


def test_rule_mode_platform_filter():
    config.CONN['tg_setup'] = {'222': {'mode': 'rule', 'name': 'c27', 'platform': 2}}
    assert _tg_targets({'platform': 2}, rule_send=True) == ['222']
    assert _tg_targets({'platform': 1}, rule_send=True) == []


def test_mixed_modes():
    config.CONN['tg_setup'] = {
        '111': {'mode': 'all', 'name': 'all', 'platform': None},
        '222': {'mode': 'rule', 'name': 'c27', 'platform': None},
    }
    # rule_send=False -> chi nhom all.
    assert sorted(_tg_targets({'platform': 1}, rule_send=False)) == ['111']
    # rule_send=True -> ca hai.
    assert sorted(_tg_targets({'platform': 1}, rule_send=True)) == ['111', '222']