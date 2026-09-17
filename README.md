# Vibotics SmartBox — React + FastAPI + MongoDB

Bản port của dự án **Unv_Smartbox** (AI box bridge cho camera UniView/Dahua) sang stack
mới: **React** (FE) + **FastAPI** (BE) + **MongoDB** (lưu trữ). Giữ nguyên 100% tính năng,
hành vi và giao diện của bản gốc (`D:\test\Unv_Smartbox`), chỉ thay thế tầng công nghệ.

---

## 1. Tổng quan kiến trúc

```
┌──────────────┐        ┌──────────────────────────────────────────────┐
│  Browser /   │  HTTP  │  FastAPI backend  (:8090)                     │
│  Electron    │ ─────► │  app/                                          │
│              │        │   ├─ box/     digest proxy, ONVIF/PTZ, go2rtc │
│              │        │   ├─ alarm/   nhận alarm, normalize, SSE      │
│              │        │   ├─ telegram/ bot + c27 attendance           │
│              │        │   ├─ api/     route cho cấu hình/algo/camera  │
│              │        │   └─ db/      MongoDB (repos thay file)       │
│              │        └───────────────┬───────────────────────────────┘
│              │                        │
│  WebSocket   │  WS    ┌───────────────▼──────────────┐   ┌───────────┐
│  video       │ ─────► │  go2rtc  (:1984)             │◄─►│  camera   │
│              │        │  nhận RTSP, trả MSE/WebRTC   │   │  (box)    │
└──────────────┘        └──────────────────────────────┘   └───────────┘
        ▲                                                          ▲
        │                                                        │
   React FE (frontend/) — build ra frontend/dist               box gửi alarm
   được serve bởi backend :8090                                 → POST /alarm
```

- **Frontend** `frontend/` — React, build ra `frontend/dist`, được backend serve tĩnh ở `/`.
- **Backend** `backend/` — FastAPI, port toàn bộ logic nghiệp vụ của `aibox.py` gốc.
- **go2rtc** — giữ nguyên binary từ bản gốc (`go2rtc.exe`, config `go2rtc.yaml`). Không port.
- **MongoDB** — thay toàn bộ file JSON/jsonl của bản gốc (alarms, tg log, config...). Ảnh alarm
  qua GridFS.
- **Electron** — giữ nguyên khái niệm wrapper desktop (chưa port trong đợt này).

> **Quan trọng**: Toàn bộ tài liệu chi tiết "muốn sửa chỗ nào thì sửa file nào, file nào làm
> gì, thêm mới thế nào" nằm ở **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**. Đọc file đó
> trước khi đụng vào code.

---

## 2. Yêu cầu môi trường

| Thành phần | Yêu cầu |
|---|---|
| Python | ≥ 3.10 (đã test với 3.13) |
| Node.js | ≥ 18 (đã test với v24) |
| MongoDB | Chạy local `mongodb://localhost:27017` (hoặc set `MONGO_URI`) |
| go2rtc | `go2rtc.exe` (Windows) / `go2rtc` (Linux) ở thư mục gốc |

> **Không bắt buộc có box/camera để chạy giao diện**: dùng **mock mode** (xem §4).

---

## 3. Cách chạy

### 3.1 Cài dependency

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 3.2 Build frontend

```bash
cd frontend
npm run build        # -> tạo frontend/dist (backend sẽ serve dist ở /)
```

### 3.3 Khởi động backend

```bash
cd backend
python run.py        # uvicorn app.main:app --host 0.0.0.0 --port 8090
```

Mở trình duyệt: **http://localhost:8090**

### 3.4 (Tùy chọn) Dev mode frontend

Khi sửa FE, chạy Vite dev server để hot-reload:

```bash
cd frontend
npm run dev          # http://localhost:5173 — proxy /api, /aibox, /events -> :8090
```

---

## 4. Mock mode — chạy giao diện KHÔNG cần box/camera

Không có mạng tới box (hoặc chưa cấu hình) thì backend vẫn boot nhưng các list
camera/alarm sẽ trống. Muốn xem giao diện có **nội dung giả** (6 camera, 150+ alarm,
SSE live, tên tiếng Việt thật), set biến môi trường:

```bash
cd backend
set MOCK_DATA=1      # Windows
python run.py
```

Mock data do `backend/app/mock.py` cung cấp — tự sinh, không gọi box, không cần mongo.
Chạy **có** `MOCK_DATA=1` thì backend bỏ qua go2rtc watchdog + telegram poll.

> Khi cần dữ liệu thật: chạy **không** `MOCK_DATA`, mở tab **Cấu hình** (`/api/conn`)
> nhập IP/user/pass box, bấm Lưu. Không nên set `MOCK_DATA` trong production.

---

## 5. Cấu hình (biến môi trường)

Xem `backend/app/config.py` cho giá trị mặc định. Có thể set qua env:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BRIDGE_PORT` | `8090` | Cổng backend |
| `GO2RTC` | `127.0.0.1:1984` | Địa chỉ go2rtc |
| `AIBOX_HOST` / `AIBOX_PORT` / `AIBOX_USER` / `AIBOX_PASS` | trống | Kết nối box (default cho tab Cấu hình) |
| `TG_BOT_TOKEN` | trống | Telegram bot token |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB |
| `MONGO_DB` | `unv_smartbox` | Tên database |
| `MOCK_DATA` | `0` | `1` = bật mock data (offline) |
| `AIBOX_DATA` | thư mục chứa backend | Thư mục dữ liệu (alarms/) |

Cấu hình kết nối box + Telegram được **lưu bền** trong MongoDB (collection `config`, qua
`repos.ConfigRepo`) — port từ `aibox.conf.json` gốc.

---

## 6. Chạy test

```bash
cd backend
python -m pytest tests/ -q          # 67+ tests, không cần box
MOCK_DATA=1 python -m pytest tests/ -q   # thêm route tests (không cần box/mongo)
```

---

## 7. Cấu trúc thư mục (tổng quan)

```
Unv_Smartbox_react/
├── backend/          # FastAPI
│   ├── app/
│   │   ├── box/        # digest proxy, RSA, ONVIF/PTZ, go2rtc
│   │   ├── alarm/      # nhận alarm, normalize, SSE
│   │   ├── telegram/   # bot, send, caption, c27
│   │   ├── api/        # route cấu hình/algo/camera/tg
│   │   ├── db/         # Mongo connection + repos
│   │   ├── main.py     # FastAPI entrypoint
│   │   ├── mock.py     # mock data offline
│   │   └── config.py   # cấu hình/env
│   ├── tests/          # pytest
│   └── run.py
├── frontend/         # React
│   ├── src/
│   │   ├── api/        # client.js, useEvents.js
│   │   ├── hooks/      # useVideoStream.js
│   │   ├── components/ # VideoTile, TileGrid, Header, Dock
│   │   ├── views/      # 8 view: Live, Detail, Log, Lib, Search, Cam, Ai, Config
│   │   ├── vendor/     # video-rtc.js (giữ nguyên)
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── dist/          # build output (backend serve)
├── go2rtc.yaml        # giữ nguyên bản gốc
├── go2rtc.exe         # binary (copy từ bản gốc)
└── docs/ARCHITECTURE.md   # ← bản đồ chi tiết, ĐỌC TRƯỚC
```

**→ Chi tiết từng file và "sửa chỗ nào" xem [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).**