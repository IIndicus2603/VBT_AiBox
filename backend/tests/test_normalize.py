#!/usr/bin/env python3
"""Tests for the ported alarm normalize module.

Ported from aibox.py. _norm_alarm (aibox.py:1746-1777) turns raw box JSON into a
UI/Telegram event: video_url is rewritten to the /aibox/video? proxy route,
person comes from compare_results[0], and ALGO_VI maps technical algo_model codes
to Vietnamese display names.
"""
import json
import time

from app.alarm import normalize


def _alarm():
    return {
        'type': 4,
        'channel_id': 'ch5',
        'channel_name': 'Cam 5',
        'event_id': 'ev-1',
        'platform': 1,
        'channel_info': {'channel_id': 'ch5', 'channel_name': 'Cam 5',
                         'ipc_addr': '10.0.0.5'},
        'behaviour': {'capture_time': 1700000000,
                      'algo_model': 'FaceRecognitionAlarm',
                      'capture_info': [{'object_type': 'person',
                                        'target_id': 7}],
                      'video_url': '/api/v2/smart/video?ChlId=5&StartTime=A&EndTime=B',
                      'video_uuid': 'vid-1'},
        'compare_results': [{'person_name': 'Nguyen Van A', 'similarity': 0.95,
                             'lib_name': 'lib1', 'image_path': '/x?q=1'}],
    }


def test_norm_alarm_returns_exact_keys():
    ev = normalize._norm_alarm(_alarm())
    assert sorted(ev.keys()) == sorted([
        'kind', 'ts', 'type', 'label', 'channel_id', 'channel_name',
        'ipc_addr', 'event_id', 'algo_model', 'capture_info', 'person',
        'area_num', 'video_url', 'video_uuid', 'platform', 'images',
    ])


def test_norm_alarm_video_url_rewritten():
    ev = normalize._norm_alarm(_alarm())
    assert ev['video_url'] == '/aibox/video?ChlId=5&StartTime=A&EndTime=B'


def test_norm_alarm_person_from_compare_results0():
    ev = normalize._norm_alarm(_alarm())
    assert ev['person'] == {'name': 'Nguyen Van A', 'similarity': 0.95,
                            'lib': 'lib1', 'image': '/aibox/picture?q=1'}


def test_norm_alarm_no_video_url_is_none():
    a = _alarm()
    del a['behaviour']['video_url']
    assert normalize._norm_alarm(a)['video_url'] is None


def test_algo_vi_size_and_helmet():
    assert len(normalize.ALGO_VI) >= 90
    assert normalize.ALGO_VI['SafetyHelmetAlarm'] == 'Không mũ bảo hộ'
    # key exists and is not empty
    assert all(normalize.ALGO_VI.values())


def test_norm_alarm_ts_from_capture_time():
    ev = normalize._norm_alarm(_alarm())
    assert ev['ts'] == 1700000000
    assert ev['label'] == 'facematch'