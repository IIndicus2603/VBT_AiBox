#!/usr/bin/env python3
"""Seed config thật (host/port/user/pass/tg) từ aibox.conf.json gốc vào Mongo.

Chỉ dùng cho test/dev. Đọc file config gốc của dự án, ghi vào Mongo config doc
(_id='conn') đúng định dạng repos.ConfigRepo.save. KHÔNG in pass ra console.
"""
import json
import os
import sys

# folder goc dự án React
REACT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# folder dự án gốc (nơi có aibox.conf.json)
SRC_CONF = r"D:\test\Unv_Smartbox\aibox.conf.json"

MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://127.0.0.1:27017')
MONGO_DB = os.environ.get('MONGO_DB', 'aibox')


def main():
    if not os.path.isfile(SRC_CONF):
        print(f'! khong thay file config goc: {SRC_CONF}')
        return 1
    raw = json.load(open(SRC_CONF, encoding='utf-8'))

    # Dung dung fields backend can (ConfigRepo.save doc _id='conn')
    conn = {
        'host': raw.get('host', ''),
        'port': int(raw.get('port', 80)),
        'user': raw.get('user', 'admin'),
        'pass': raw.get('pass', ''),
        'tg_token': raw.get('tg_token', ''),
        'tg_chats': raw.get('tg_chats', []),
        'tg_setup': raw.get('tg_setup', {}),
    }

    from pymongo import MongoClient
    c = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = c[MONGO_DB]
    db['config'].update_one(
        {'_id': 'conn'},
        {'$set': {k: v for k, v in conn.items()}},
        upsert=True,
    )
    masked = {k: ('***' if k == 'pass' and v else v) for k, v in conn.items()}
    print(f'[seed] da ghi config vao mongodb://127.0.0.1:27017/{MONGO_DB}/config')
    print(f'[seed] {json.dumps(masked, ensure_ascii=False, indent=2)}')
    c.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())