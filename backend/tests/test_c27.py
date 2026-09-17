#!/usr/bin/env python3
"""Tests for the c27 attendance state machine (_c27_decide).

Pure-logic: repos.TgPersonTodayRepo / repos.TgPersonLogRepo are monkeypatched to
dict fakes (no live mongo). Verifies the rule table verbatim from aibox.py:1597-1664:
  - EnterArea always sends + title
  - LineDetectorCrossed before 08:30 silent / after 17:30 sends
  - WorkClothesAlarm only when person known AND not already marked uniform
"""
import time

import pytest

from app.db import repos
from app.telegram.c27 import _c27_decide


class FakeToday:
    """Dict fake cua repos.TgPersonTodayRepo (cung logic nhu load/save)."""

    def __init__(self):
        self.state = {}

    def load(self, day):
        d = self.state.get(day)
        if d and d.get('date') == day:
            for k, zero in (('first', {}), ('late', []), ('uniform', [])):
                if not isinstance(d.get(k), type(zero)):
                    d[k] = zero
            return d
        return {'date': day, 'first': {}, 'late': [], 'uniform': []}

    def save(self, day, st):
        st['date'] = day
        self.state[day] = dict(st)


class FakeLog:
    """Dict fake cua repos.TgPersonLogRepo (append-only)."""

    def __init__(self):
        self.rows = []

    def append(self, rec):
        self.rows.append(rec)


def _ts(hour, minute=0):
    """Epoch cua gio dia phuong ngay hom nay (dung chung cho _c27_hm)."""
    t = time.localtime()
    return time.mktime(time.struct_time(
        (t.tm_year, t.tm_mon, t.tm_mday, hour, minute, 0, 0, 0, -1)))


@pytest.fixture
def fakes(monkeypatch):
    fake_today, fake_log = FakeToday(), FakeLog()
    monkeypatch.setattr(repos, 'TgPersonTodayRepo', fake_today)
    monkeypatch.setattr(repos, 'TgPersonLogRepo', fake_log)
    return fake_today, fake_log


def test_enter_area_always_sends_with_title(fakes):
    title, send, mark = _c27_decide({'algo_model': 'EnterArea', 'ts': _ts(12)})
    assert send is True
    assert title == 'Xâm phạm khu vực'
    assert mark is None


def test_line_crossed_before_0830_silent(fakes):
    # 07:00 < 08:30 -> im lang, van khong danh dau.
    title, send, mark = _c27_decide(
        {'algo_model': 'LineDetectorCrossed', 'ts': _ts(7), 'person': {'name': 'An'}})
    assert send is False
    assert title is None
    assert mark is None


def test_line_crossed_after_1730_sends(fakes):
    # 18:00 >= 17:30 -> gui binh thuong.
    title, send, mark = _c27_decide(
        {'algo_model': 'LineDetectorCrossed', 'ts': _ts(18), 'person': {'name': 'An'}})
    assert send is True
    assert title is None
    assert mark is None


def test_workclothes_known_person_not_marked_sends(fakes):
    title, send, mark = _c27_decide(
        {'algo_model': 'WorkClothesAlarm', 'ts': _ts(12),
         'person': {'name': 'An', 'lib': 'Default List'}})
    assert send is True
    assert title == 'Sai đồng phục'
    assert mark == ('uniform', 'An')


def test_workclothes_known_person_already_marked_silent(fakes):
    fake_today, _ = fakes
    day = time.strftime('%Y-%m-%d')
    # Nguoi nay da bi danh dau sai dong phuc hom nay -> khong gui nua.
    fake_today.state[day] = {'date': day, 'first': {},
                             'late': [], 'uniform': ['An']}
    title, send, mark = _c27_decide(
        {'algo_model': 'WorkClothesAlarm', 'ts': _ts(12),
         'person': {'name': 'An', 'lib': 'Default List'}})
    assert send is False
    assert title == 'Sai đồng phục'
    assert mark is None


def test_workclothes_unknown_person_silent(fakes):
    # Vo danh (person khong co ten / khac thu vien) -> khong gui trong gio lam viec.
    title, send, mark = _c27_decide(
        {'algo_model': 'WorkClothesAlarm', 'ts': _ts(12), 'person': {}})
    assert send is False
    assert title == 'Sai đồng phục'
    assert mark is None