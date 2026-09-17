import json, traceback, urllib.request, os
os.environ.setdefault('MONGO_URI','mongodb://127.0.0.1:27017')
os.environ.setdefault('MONGO_DB','aibox')
from app.db import mongo
mongo.connect()
from app import config
from app.db import repos
config.CONN.update(repos.ConfigRepo.load(config.CONN))
from app.telegram import c27
from app.alarm import publish
publish.tg_forward = c27._tg_forward
# lấy 1 alarm có ảnh + person
d=json.load(urllib.request.urlopen('http://localhost:8090/api/alarms?n=200'))
evs=[a for a in d['data'] if a.get('images') and a.get('person')]
print('alarms co anh+person:', len(evs))
ev=evs[0] if evs else d['data'][0]
print('test ev:', ev.get('algo_model'), ev.get('channel_name'), 'person=', ev.get('person'))
try:
    c27._tg_forward(ev)
    print('OK: forward khong crash')
except Exception as e:
    traceback.print_exc()
