"""Mongo connection wrapper. Defaults via MONGO_URI / MONGO_DB env, overridable
with the connect(uri, db) args. Creates the indexes the repos rely on."""
import os

from pymongo import MongoClient

_URI = os.environ.get('MONGO_URI', 'mongodb://127.0.0.1:27017')
_DB = os.environ.get('MONGO_DB', 'aibox')

_client = None
_db = None


def connect(uri=_URI, db=_DB):
    global _client, _db
    _client = MongoClient(uri, serverSelectionTimeoutMS=3000)
    _db = _client[db]
    _ensure_indexes()
    return _db


def db():
    if _db is None:
        raise RuntimeError('mongo.connect() chua duoc goi')
    return _db


def _ensure_indexes():
    if _db is None:
        return
    # Alarm tail va loc theo camera (newest-first)
    _db['alarms'].create_index([('capture_time', -1), ('channel_id', 1)])
    # Tra cuu theo id (next_id)
    _db['tg_alarm_log'].create_index([('id', 1)])
    # Thong ke theo person tung ngay
    _db['tg_person_log'].create_index([('day', 1), ('person', 1)])


def close():
    global _client, _db
    if _client is not None:
        _client.close()
        _client = None
        _db = None