#!/usr/bin/env python3
"""Tests for the ported alarm receiver module.

Ported from aibox.py: handle_alarm (aibox.py:1813) and _box_gate (aibox.py:885).
The receiver gates out "stale replay" bursts after a box<->BE link drop and only
keeps the newest alarm per reconnect window. handle_alarm with an empty/{} body
is a keep-alive heartbeat (type None) that must be dropped without crash and
without touching mongo.
"""
from app.alarm import receiver


def test_handle_alarm_empty_json_no_crash():
    # type None -> heartbeat keep-alive, dropped before any processing.
    receiver.handle_alarm(b'{}', 'application/json')
    receiver.handle_alarm(b'', 'application/json')
    assert receiver._AREA == {}


def test_box_gate_cold_start_returns_true():
    # _BOX_RECON_UNTIL==0 on first call -> accept immediately, no reconnect window.
    assert receiver._box_gate({'behaviour': {'capture_time': 1}}, 'stamp-1') is True