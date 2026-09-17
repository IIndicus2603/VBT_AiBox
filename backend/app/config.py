#!/usr/bin/env python3
"""Config: constants + connection settings, ported from aibox.py lines 14-40."""
import os
import sys

PORT      = int(os.environ.get('BRIDGE_PORT', '8090'))
GO2RTC    = os.environ.get('GO2RTC', '127.0.0.1:1984')
# _MEIPASS = PyInstaller onefile temp dir (read-only, bundled assets);
# HERE = bundle dir (go2rtc.exe, ui/); DATA = writable dir (config, alarms, logs).
HERE      = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
DATA      = os.environ.get('AIBOX_DATA', HERE)
UI_DIR    = os.path.join(HERE, 'ui')
ALARM_DIR = os.path.join(DATA, 'alarms')
CONF      = os.path.join(DATA, 'aibox.conf.json')
GO2RTC_EXE = os.path.join(HERE, 'go2rtc.exe' if os.name == 'nt' else 'go2rtc')
GO2RTC_LOG = os.path.join(DATA, 'go2rtc.log')
# Chi tu spawn khi GO2RTC tro ve may nay; tro sang may khac thi may do tu lo.
GO2RTC_LOCAL = GO2RTC.rsplit(':', 1)[0] in ('127.0.0.1', 'localhost', '::1', '')

# Thong tin ket noi box: sua duoc luc dang chay qua tab Cau hinh, khong phai
# hardcode. Env var chi la gia tri mac dinh cho lan dau.
CONN = {'host': os.environ.get('AIBOX_HOST', ''),
        'port': int(os.environ.get('AIBOX_PORT', '80')),
        'user': os.environ.get('AIBOX_USER', 'admin'),
        'pass': os.environ.get('AIBOX_PASS', ''),
        # Telegram: gui anh/video + thong tin canh bao vao NHIEU nhom (tick chon).
        # Token = secret, dung commit. tg_chats = list chat_id dang chon gui den.
        'tg_token': os.environ.get('TG_BOT_TOKEN', ''),
        'tg_chats': [c.strip() for c in os.environ.get('TG_CHAT_IDS', '').split(',') if c.strip()],
        # tg_setup: chat_id -> {'mode':'all'|'rule', 'name':ten, 'algos':[algo_model]}.
        # Nhom KHONG co mat o day = chua /setup = khong nhan alarm nao.
        'tg_setup': {}}