import json, traceback, urllib.request, os
os.environ.setdefault('MONGO_URI','mongodb://127.0.0.1:27017')
os.environ.setdefault('MONGO_DB','aibox')
from app.db import mongo
mongo.connect()
from app import config
from app.db import repos
config.CONN.update(repos.ConfigRepo.load(config.CONN))
from app.telegram import c27, send, caption
d=json.load(urllib.request.urlopen('http://localhost:8090/api/alarms?n=200'))
evs=[a for a in d['data'] if a.get('images') and a.get('person')]
ev=evs[0]
print('=== test ev ===', ev.get('algo_model'), '| person=', ev.get('person'), '| images=', ev.get('images'))
try:
    print('--- _c27_person ---'); print('person=', c27._c27_person(ev))
    print('--- _c27_decide ---'); t,s,m=c27._c27_decide(ev); print('title,send,mark=',t,s,m)
    chats = send._tg_targets(ev, s)
    print('--- _tg_targets ---', chats)
    img = caption._tg_image(ev)
    print('--- _tg_image ---', 'None' if img is None else (img[0], len(img[1]), img[2]))
    if img:
        aid = caption._tg_next_id()
        cap = caption._tg_caption(ev, aid, t)
        print('--- _tg_caption ---', repr(cap)[:200])
except Exception as e:
    traceback.print_exc()
