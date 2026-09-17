"""Repos: mongo equivalents of aibox.py's file-IO functions.

Each class mirrors the behavior of the corresponding aibox.py function, verified
against the real source:
  - _alarm_tail (aibox.py:959)          -> AlarmRepo.tail
  - _area_last (aibox.py:913)           -> AlarmRepo.area_last
  - _tg_log_tail (aibox.py:1496)        -> TgAlarmLogRepo.tail
  - _tg_next_id (aibox.py:1518)         -> TgAlarmLogRepo.next_id
  - _tg_alarm_log (aibox.py:1527)       -> TgAlarmLogRepo.append
  - _tg_load_seen/_tg_save_seen (:816)  -> TgGroupsRepo.load/save
  - _c27_load/_c27_save (aibox.py:1566) -> TgPersonTodayRepo.load/save
  - load_conf/save_conf (aibox.py:43)   -> ConfigRepo.load/save
  - tg_person_log.jsonl (append-only)   -> TgPersonLogRepo.append

naming: a "doc" is a JSON dict that would previously have been one jsonl line.
"""
import time

from . import mongo


class AlarmRepo:
    """alarms.jsonl <-> mongo.alarms. Alarm docs keep the fields the box pushes:
    capture_time, channel_id, behaviour/face, video_url/video, algo_model ..."""

    @staticmethod
    def append(doc):
        if 'capture_time' not in doc:
            doc['capture_time'] = int(time.time())
        doc['seen'] = False                 # alarm mới -> chưa đọc (badge "cảnh báo mới")
        mongo.db()['alarms'].insert_one(doc)

    # Alarm ĐẾM ĐƯỢC cho badge: phai khop bo loc cua POST /api/alarms (alarm/routes.py)
    # — keepalive type 2/6/7 va AreaRuleData (dem nguoi real-time, ~1 dong/giay) khong
    # bao gio hien trong nhat ky nen khong duoc tinh. Dem ca chung thi badge noi 72 ma
    # danh sach chi co 18 dong. Sua bo loc o day thi sua ca ben route.
    _COUNTABLE = {'type': {'$nin': [2, 6, 7]},
                  'behaviour.algo_model': {'$ne': 'AreaRuleData'}}
    # Thieu field 'seen' cung la chua doc: alarm ghi truoc khi co field nay khong co no,
    # {'seen': False} se khong khop.
    _UNSEEN = {'seen': {'$ne': True}}

    @staticmethod
    def unread_count():
        """Số cảnh báo chưa đọc — chỉ loại thực sự hiện trong nhật ký."""
        return mongo.db()['alarms'].count_documents(
            {**AlarmRepo._COUNTABLE, **AlarmRepo._UNSEEN})

    @staticmethod
    def mark_read(event_ids=None, all_=False):
        """Đánh dấu đã đọc: 1 alarm (event_id) hoặc tất cả. Trả số đã đánh dấu."""
        flt = ({**AlarmRepo._COUNTABLE, **AlarmRepo._UNSEEN} if all_
               else {'event_id': {'$in': event_ids or []}})
        res = mongo.db()['alarms'].update_many(
            flt, {'$set': {'seen': True}},
            upsert=False,
        )
        return res.modified_count

    @staticmethod
    def tail(n):
        """N dong CUOI (moi nhat) cua alarms.jsonl, moi nhat truoc. Giong
        _alarm_tail: tra ve n doc moi nhat theo capture_time, giam dan."""
        docs = list(mongo.db()['alarms'].find(
            {}, {'_id': 0}
        ).sort([('capture_time', -1)]).limit(n))
        return docs

    @staticmethod
    def area_last(channel_id):
        """So dem nguoi CUOI CUNG da tung nhan cho 1 camera. Giong _area_last:
        quet alarm moi nhat co AreaRuleData cho channel do -> (count, name)."""
        doc = mongo.db()['alarms'].find_one(
            {'channel_id': channel_id, 'behaviour.algo_model': 'AreaRuleData'},
            {'_id': 0}
        )
        if not doc:
            return None, None
        ob = doc.get('behaviour') or {}
        ci = doc.get('channel_info') or {}
        name = ci.get('channel_name') or doc.get('channel_name') or ('CH' + str(channel_id))
        return ob.get('area_num'), name


class TgAlarmLogRepo:
    """tg_alarm_log.jsonl <-> mongo.tg_alarm_log. Record: id, ts, cap, url, file, algo."""

    @staticmethod
    def append(aid, ev, cap):
        rec = {'id': aid, 'ts': ev.get('ts') or int(time.time()), 'cap': cap,
               'url': ev.get('video_url') or '', 'file': ev.get('video') or '',
               'algo': ev.get('algo_model') or ''}
        mongo.db()['tg_alarm_log'].insert_one(rec)

    @staticmethod
    def tail(n):
        """N dong cuoi, moi nhat truoc. Giong _tg_log_tail: chi doc duoi
        (mongo sort giam dan theo id, khong can doc ca collection)."""
        return list(mongo.db()['tg_alarm_log'].find(
            {}, {'_id': 0}
        ).sort([('id', -1)]).limit(n))

    @staticmethod
    def next_id():
        """So thu tu alarm, tang dan. Giong _tg_next_id: noi tiep tu id lon nhat.

        Collection trong (find_one None) -> tra 1, giong max([] or [0]) cua bản gốc.
        Khong duoc goi .get tren None — bug 'NoneType has no attribute get' khi
        tg_alarm_log chua co alarm nao."""
        last = mongo.db()['tg_alarm_log'].find_one(
            {}, {'_id': 0, 'id': 1}, sort=[('id', -1)]
        )
        if last is None:
            return 1
        return (last.get('id') or 0) + 1


class TgGroupsRepo:
    """_tg_load_seen/_tg_save_seen <-> mongo.tg_groups: {chat_id: state_dict}.
    Keep-keys-on-save and default-dict behavior mirrored from the file version."""

    @staticmethod
    def load():
        """Giong _tg_load_seen: tra dict, {} neu chua co/hong."""
        doc = mongo.db()['tg_groups'].find_one({'_id': 'seen'}, {'_id': 0})
        if doc and isinstance(doc, dict):
            return doc
        return {}

    @staticmethod
    def save(seen):
        """Giong _tg_save_seen: ghi de ca dict (replace, khong merge)."""
        mongo.db()['tg_groups'].replace_one(
            {'_id': 'seen'}, {'_id': 'seen', **seen}, upsert=True
        )


class TgPersonTodayRepo:
    """_c27_load/_c27_save <-> mongo.tg_person_today, 1 doc / ngay (key: day).

    State cua NGAY, doi ngay thi reset. Giong _c27_load: file mang ngay khac
    (hoac hong) -> state trang = reset.
    """

    _DAY_KEY = 'day'

    @staticmethod
    def load(day):
        doc = mongo.db()['tg_person_today'].find_one({'_id': day}, {'_id': 0})
        if doc and isinstance(doc, dict) and doc.get('date') == day:
            for k, zero in (('first', {}), ('late', []), ('uniform', [])):
                if not isinstance(doc.get(k), type(zero)):
                    doc[k] = zero
            return doc
        return {'date': day, 'first': {}, 'late': [], 'uniform': []}

    @staticmethod
    def save(day, st):
        st['date'] = day
        mongo.db()['tg_person_today'].replace_one(
            {'_id': day}, {'_id': day, **st}, upsert=True
        )


class TgPersonLogRepo:
    """tg_person_log.jsonl (append-only) <-> mongo.tg_person_log. Muon biet "lan 1
    o camera nao, lan 2 o dau" thi loc theo person roi sap theo ts."""

    @staticmethod
    def append(rec):
        if 'ts' not in rec:
            rec['ts'] = int(time.time())
        mongo.db()['tg_person_log'].insert_one(rec)


class ConfigRepo:
    """aibox.conf.json <-> mongo.config, doc _id='conn'. Keep-keys-on-load and
    port/int coercion mirrored from load_conf/save_conf (aibox.py:43-72)."""

    @staticmethod
    def load(default_conn):
        """Giong load_conf: chi lay cac key co trong CONN, convert port, chuan hoa
        tg_chats / tg_setup. Tra dict moi truoc, luu lai neu co default."""
        doc = mongo.db()['config'].find_one({'_id': 'conn'}, {'_id': 0})
        conn = dict(default_conn)
        if doc and isinstance(doc, dict):
            conn.update({k: v for k, v in doc.items() if k in conn})
            conn['port'] = int(conn['port'] or 80)
            # tg_chats luon la list[str]; migrate tu tg_chat cu (1 nhom) neu co.
            if not isinstance(conn.get('tg_chats'), list):
                conn['tg_chats'] = []
            conn['tg_chats'] = [str(c).strip() for c in conn['tg_chats'] if str(c).strip()]
            if not conn['tg_chats'] and str(doc.get('tg_chat', '')).strip():
                conn['tg_chats'] = [str(doc['tg_chat']).strip()]
            # tg_setup luon la dict[str, dict]; bo entry rac de _tg_targets khong vo.
            if not isinstance(conn.get('tg_setup'), dict):
                conn['tg_setup'] = {}
            conn['tg_setup'] = {str(k): v for k, v in conn['tg_setup'].items()
                                if isinstance(v, dict)}
        return conn

    @staticmethod
    def save(conn):
        """Giong save_conf: ghi de ca dict CONN."""
        mongo.db()['config'].replace_one(
            {'_id': 'conn'}, {'_id': 'conn', **conn}, upsert=True
        )