#!/usr/bin/env python3
"""FastAPI entrypoint for the Vibotics SmartBox bridge.

Boots the app, wires CORS (mirroring aibox.py's _cors whitelist), connects to
mongo (guarded — app still boots if mongo is down), loads persisted config into
CONN, and starts the background watchdog / telegram threads. Serves the React
frontend from ../frontend/dist when present, plus /alarms/<file> images from the
alarm directory.
"""
import os
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app import config
from app import mock
from app.box import go2rtc
from app.db import mongo, repos
from app.routers import api as api_router
from app.telegram import bot as tg_bot
from app.alarm import routes as alarm_router
from app.box import routes as box_router
from app.api import conn as conn_router
from app.api import algo as algo_router
from app.api import cameras as cameras_router
from app.api import tg as tg_router

app = FastAPI(title='Vibotics SmartBox')

# CORS mirror of aibox.py _cors whitelist: only the dev servers on localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r'^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$',
    allow_methods=['GET', 'POST', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type'],
)


def _load_conn():
    """Load persisted config from mongo into config.CONN (port load_conf logic)."""
    try:
        conn = repos.ConfigRepo.load(config.CONN)
    except Exception as e:
        print(f'! khong doc duoc config tu mongo: {e}')
        conn = config.CONN
    config.CONN.clear()
    config.CONN.update(conn)


def _startup_threads():
    """Background daemon threads. Watchdog only when not in mock mode; telegram
    poll only when a token is configured."""
    if mock.mock_enabled():
        print('[mock] MOCK_DATA=1 -> bo qua go2rtc watchdog + tg poll')
        return
    # go2rtc watchdog: keep :1984 alive.
    threading.Thread(target=go2rtc.go2rtc_watchdog, daemon=True).start()
    # Telegram poll: listen for /setup /video etc. Only when a token exists.
    if config.CONN.get('tg_token'):
        threading.Thread(target=tg_bot._tg_poll, daemon=True).start()
    else:
        print('! chua co tg_token -> bo qua telegram poll')


@app.on_event('startup')
async def on_startup():
    try:
        mongo.connect()
        print('[main] mongo connected')
    except Exception as e:
        print(f'! mongo khong noi duoc: {e} -> app van boot (offline)')
    _load_conn()
    _startup_threads()


@app.on_event('shutdown')
async def on_shutdown():
    try:
        mongo.close()
    except Exception:
        pass


# ---------------------------------------------------------------- routers
app.include_router(api_router.router)          # /api/health, GET cameras/algo/all/alarms
app.include_router(alarm_router.router)        # POST /alarm, /api/alarms, /events, aibox media
app.include_router(box_router.router)          # /aibox proxy, /api/channel*, discover, sync, ptz
app.include_router(conn_router.router)         # /api/conn + docking/tg config
app.include_router(algo_router.router)         # POST /api/algo/*, /api/hashrate
app.include_router(cameras_router.router)      # POST /api/cameras
app.include_router(tg_router.router)           # POST /api/tg/groups, /api/tg/chatname


# ---------------------------------------------------------------- static / alarms
# Path: backend/app/main.py -> up 3 levels = repo root. dist = root/frontend/dist.
_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'frontend', 'dist')

# Route /alarms/{name} PHẢI khai báo TRƯỚC app.mount('/') — nếu mount trước, nó
# chiếm mọi path (kể cả /alarms/*) và trả 404 từ StaticFiles trước khi route này
# chạy, làm ảnh alarm (GridFS/file) không bao giờ serve được.
@app.get('/alarms/{name}')
def alarm_image(name: str):
    """Serve alarm image files. Ưu tiên file trong config.ALARM_DIR (như aibox.py);
    fallback đọc từ MongoDB GridFS theo filename (base64 alarm live được _save_images
    lưu vào GridFS chứ KHÔNG ra file — nếu không fallback thì ảnh alarm mới qua SSE
    báo 404 "ảnh lỗi" tới khi reload)."""
    safe = os.path.basename(name)                       # no path traversal
    path = os.path.join(config.ALARM_DIR, safe)
    if os.path.isfile(path):
        return FileResponse(path)
    # Fallback GridFS: filename đúng như _save_images ghi ({stamp}_{tag}_{key}.jpg)
    try:
        import gridfs
        fs = gridfs.GridFS(mongo.db())
        g = fs.find_one({'filename': safe})
        if g is not None:
            return Response(content=g.read(), media_type='image/jpeg')
    except Exception as e:
        print(f'[alarms] GridFS fallback loi cho {safe!r}: {e!r}')
    return JSONResponse({'code': -1, 'msg': 'khong thay anh'}, status_code=404)


if os.path.isdir(_FRONTEND_DIST):
    _INDEX = os.path.join(_FRONTEND_DIST, 'index.html')
    # Serve index.html KHÔNG cache (Cache-Control: no-cache) để mỗi lần refresh
    # browser luôn revalidate và tải bundle mới (Vite đổi tên file theo hash). Nếu
    # thiếu, browser cache index.html cũ -> vẫn trỏ bundle cũ dù dist đã build mới.
    # Route '/' đăng ký TRƯỚC mount('/') nên match path gốc; các asset /assets/* vẫn
    # đi qua StaticFiles (có hash nên cache lâu được).
    @app.get('/', include_in_schema=False)
    def _serve_index():
        return FileResponse(_INDEX, headers={'Cache-Control': 'no-cache'})
    app.mount('/', StaticFiles(directory=_FRONTEND_DIST, html=True), name='frontend')