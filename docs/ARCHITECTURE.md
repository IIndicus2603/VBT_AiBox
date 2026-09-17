# Kiến trúc & Bản đồ sửa đổi — Vibotics SmartBox (React + FastAPI + MongoDB)

Tài liệu này trả lời 3 câu:
1. **Muốn sửa một chức năng cụ thể thì phải sửa file nào?**
2. **Mỗi file trong project này có tác dụng gì?**
3. **Muốn thêm tính năng mới thì làm sao mà vẫn giữ cấu trúc?**

Đọc file này TRƯỚC khi đụng vào code. Project này là port của `D:\test\Unv_Smartbox`
(aibox.py + UI vanilla), nên mọi đường dẫn dòng nguồn gốc `aibox.py:xxx` trong code đều
trỏ tới bản gốc để đối chiếu khi cần.

---

## 1. Quy tắc vàng (đọc kỹ)

1. **Cấu trúc theo lớp, không theo tính năng chéo.** Backend chia `box` / `alarm` /
   `telegram` / `api` / `db`. Khi thêm code, đặt vào đúng lớp — đừng nhét logic box vào
   route API.
2. **Mọi truy cập MongoDB phải qua `db/repos.py`.** Không gọi pymongo trực tiếp ở nơi khác.
   Repo là nơi duy nhất biết cấu trúc collection.
3. **Mỗi module backend chỉ "sở hữu" các hàm của nó.** Không re-export hàm của module khác
   (lỗi đã từng xảy ra khi port — gây trùng lặp khủng khiếp). Muốn dùng hàm của module
   khác thì `import`, không copy.
4. **FE dùng CSS class có sẵn trong `style.css`.** Không thêm CSS mới cho tính năng đã có
   class. Chỉ thêm class khi thật sự cần style mới.
5. **Text tiếng Việt giữ nguyên.** Không đổi message, caption, label, toast.
6. **Chạy test sau mỗi lần sửa backend**: `cd backend && python -m pytest tests/ -q`.
7. **`MOCK_DATA=1`** là chế độ offline — dữ liệu tự sinh trong `backend/app/mock.py`,
   không gọi box/mongo. Khi sửa logic thật, kiểm tra cả 2 chế độ.

---

## 2. Bản đồ: "Muốn sửa X thì sửa file nào?"

### 2.1 Backend — chức năng nghiệp vụ

| # | Tôi muốn sửa… | File chính cần sửa | Ghi chú |
|---|---|---|---|
| B1 | **Cấu hình IP/user/pass box, cổng** | `backend/app/config.py` (mặc định/env) + `backend/app/api/conn.py` (route lưu) + `backend/app/db/repos.py` (`ConfigRepo`) | Port `aibox.py:14-40, 43-72` |
| B2 | **Kết nối digest tới box** (auth MD5) | `backend/app/box/client.py` | Class `Aibox`, `box` singleton |
| B3 | **Mã hóa mật khẩu camera (RSA PKCS#1)** | `backend/app/box/rsa.py` | `rsa_pubkey`, `rsa_encrypt` |
| B4 | **ONVIF/PTZ điều khiển camera** | `backend/app/box/onvif.py` | `_ptz_cmd`, `_onvif_body` |
| B5 | **Đồng bộ camera → go2rtc, thêm/sửa/xóa channel** | `backend/app/box/go2rtc.py` (sync) + `backend/app/box/routes.py` (route add/update/delete) | `sync_streams`, `_add_channel` |
| B6 | **Tên hiển thị tiếng Việt của thuật toán** | `backend/app/alarm/normalize.py` → dict `ALGO_VI` | Bảng 98 tên, port nguyên vẹn |
| B7 | **Chuẩn hóa alarm → event cho UI** | `backend/app/alarm/normalize.py` | `_norm_alarm`, `_person_of` |
| B8 | **Lưu ảnh alarm** | `backend/app/alarm/normalize.py` → `_save_images` | Dùng GridFS (Mongo) thay file .jpg |
| B9 | **Nhận alarm từ box (`POST /alarm`)** | `backend/app/alarm/receiver.py` + `backend/app/alarm/routes.py` | `handle_alarm`, `_process_alarm` |
| B10 | **Chống "lấy lại hàng cũ" khi mất/nối mạng** | `backend/app/alarm/receiver.py` | `_box_gate`, `_box_recon_drain` (cửa sổ 20s) |
| B11 | **Phát SSE realtime (`/events`)** | `backend/app/alarm/publish.py` | `_publish`, `_subs` |
| B12 | **Đọc lịch sử alarm (tab Nhật ký)** | `backend/app/alarm/routes.py` + `backend/app/db/repos.py` (`AlarmRepo.tail`) | Port `_alarm_tail` |
| B13 | **Gửi ảnh/video alarm lên Telegram** | `backend/app/telegram/caption.py` + `backend/app/telegram/send.py` | `_tg_caption`, `_tg_post` |
| B14 | **Lệnh Telegram** (`/countpeople`, `/setup`, `/video`, `/uniform`, `/late`) | `backend/app/telegram/bot.py` | `_tg_handle_command`, `_tg_poll` |
| B15 | **Logic chấm công c27** (đồng phục/đi muộn) | `backend/app/telegram/c27.py` | `_c27_decide`, `_c27_mark`, `_tg_forward` |
| B16 | **Lưu cấu hình Telegram/nhóm đã setup** | `backend/app/db/repos.py` (`ConfigRepo`, `TgGroupsRepo`) + `backend/app/telegram/bot.py` | |
| B17 | **Đăng ký alarm URL vào box (docking slot 1|2)** | `backend/app/api/conn.py` | `_docking_register`, `_docking_info` |
| B18 | **Kiểm tra kết nối box** | `backend/app/api/conn.py` (`/api/conn/test`) | |
| B19 | **Danh sách thuật toán box hỗ trợ/nạp** | `backend/app/api/algo.py` (`/api/algo/all`, `/api/algo/save`) | |
| B20 | **Danh sách camera + AI đang bật** | `backend/app/api/cameras.py` (`/api/cameras`) | |
| B21 | **Dữ liệu giả (mock, khi không có box)** | `backend/app/mock.py` | Tự sinh, dùng `ALGO_VI` |
| B22 | **Serve file tĩnh FE build + ảnh `/alarms/`** | `backend/app/main.py` (cuối file) | Port `translate_path` |

### 2.2 Backend — route API (FE gọi vào)

| Route | File route | Nghiệp vụ |
|---|---|---|
| `POST /alarm` | `backend/app/alarm/routes.py` | Box POST alarm về |
| `POST /api/alarms` | `backend/app/alarm/routes.py` | Lịch sử alarm (tab Nhật ký) |
| `GET /events` | `backend/app/alarm/routes.py` | SSE realtime |
| `GET /aibox/picture`, `GET /aibox/video` | `backend/app/alarm/routes.py` | Ảnh/clip từ box (kèm Range) |
| `GET /aibox/export/*`, `DELETE /aibox/dao/delete` | `backend/app/alarm/routes.py` | Search export |
| `POST /aibox/{path}` | `backend/app/box/routes.py` | Proxy chung tới box (`/api/v2/...`) |
| `POST /api/channel/add|update|delete` | `backend/app/box/routes.py` | Quản lý camera |
| `POST /api/discover*`, `/api/sync` | `backend/app/box/routes.py` | Tìm camera, đồng bộ |
| `POST /api/ptz` | `backend/app/box/routes.py` | Điều khiển PTZ |
| `GET/POST /api/conn*` | `backend/app/api/conn.py` | Cấu hình box + docking + tgtest |
| `POST /api/algo/all|save`, `/api/hashrate` | `backend/app/api/algo.py` | Thuật toán |
| `POST /api/cameras` | `backend/app/api/cameras.py` | Danh sách camera |
| `POST /api/tg/groups`, `/api/tg/chatname` | `backend/app/api/tg.py` | Telegram groups |
| `GET /api/health` | `backend/app/routers/api.py` | Health check + mock flag |
| `GET /alarms/{name}` | `backend/app/main.py` | Ảnh alarm |

> Lưu ý: có **2 bộ router** — `backend/app/routers/api.py` (cũ, giữ `/api/health`) và
> `backend/app/api/*.py` (mới). `backend/app/routers/events.py` được giữ trên disk nhưng
> **không** được mount vào `main.py` (đã thay bằng `app/alarm/routes.py`). Đừng thêm route
> trùng method+path vào cả 2 chỗ — sẽ xung đột.

### 2.3 Frontend — view (màn hình)

> **Quan trọng**: Dock chỉ có **6 nút chính** (Xem trực tiếp, Nhật ký, Thư viện, Tìm kiếm,
> Camera, Cấu hình). `detail` và `ai` là **2 view phụ** — không có nút riêng, được mở từ
> view khác (bấm camera ở Live → `detail`; bấm "Cấu hình AI" → `ai`). Trong `App.jsx`,
> `go()` map: `detail` sáng nút "Xem trực tiếp", `ai` sáng nút "Cấu hình".

| # | Màn hình | View component | Có nút dock? | Nghiệp vụ |
|---|---|---|---|---|
| F1 | Xem trực tiếp | `frontend/src/views/LiveView.jsx` | ✅ (live) | Grid camera live, layout 2x2/3x3/4x4, rail thông báo |
| F2 | Chi tiết camera | `frontend/src/views/DetailView.jsx` | ❌ view phụ | Player lớn + PTZ + AI status + lịch sử (mở từ Live) |
| F3 | Nhật ký | `frontend/src/views/LogView.jsx` | ✅ (log) | Timeline alarm, filter, xem lại clip |
| F4 | Thư viện | `frontend/src/views/LibView.jsx` | ✅ (lib) | Người / đồng phục (personlib/workclotheslib) |
| F5 | Tìm kiếm | `frontend/src/views/SearchView.jsx` | ✅ (search) | Tìm alarm theo camera/loại/thời gian |
| F6 | Camera | `frontend/src/views/CamView.jsx` | ✅ (cam) | Danh sách camera, thêm/sửa/xóa, discover |
| F7 | Cấu hình AI | `frontend/src/views/AiView.jsx` | ❌ view phụ | Vẽ vùng ROI, quy tắc/lịch/liên kết (mở từ Detail) |
| F8 | Cấu hình | `frontend/src/views/ConfigView.jsx` | ✅ (cfg) | Kết nối box, Telegram, docking slot |

### 2.4 Frontend — thành phần dùng chung

| Thành phần | File | Tác dụng |
|---|---|---|
| API helpers | `frontend/src/api/client.js` | `jget`, `post`, `BASE`, `G`, `hms`, `mask`, `fixPct`, `nice` |
| SSE hook | `frontend/src/api/useEvents.js` | Lắng nghe `/events`, gọi callback khi có alarm |
| Video hook | `frontend/src/hooks/useVideoStream.js` | Bọc go2rtc video: stall watchdog, retry, state |
| Transport video | `frontend/src/vendor/video-rtc.js` | **Giữ nguyên** (Web Component MSE/WebRTC) |
| Ô video | `frontend/src/components/VideoTile.jsx` | 1 ô video + badge trạng thái |
| Grid video | `frontend/src/components/TileGrid.jsx` | Lưới nhiều VideoTile + phân trang |
| Header | `frontend/src/components/Header.jsx` | Logo, đồng hồ, trạng thái box |
| Dock | `frontend/src/components/Dock.jsx` | 8 nút tab chuyển view |
| App shell | `frontend/src/App.jsx` | Điều hướng view (port `go()`) |
| Entry | `frontend/src/main.jsx` | Mount React |
| Style | `frontend/src/style.css` | Toàn bộ design system (giữ nguyên) |

---

## 3. Chi tiết từng module backend

### 3.1 `backend/app/config.py`
- Port `aibox.py:14-40`. Chứa hằng + dict `CONN` (kết nối box, telegram, tg_setup).
- **Sửa khi**: đổi giá trị mặc định/cổng/tên biến env. Muốn thêm biến cấu hình mới → thêm
  vào `CONN` ở đây, rồi vào `db/repos.py` `ConfigRepo.load` để nó được lưu bền.

### 3.2 `backend/app/box/client.py`
- Class `Aibox`: digest auth MD5 tới box, cache challenge, retry 401. Singleton `box`.
- **Sửa khi**: đổi cách auth, thêm method gọi box. FE/route gọi `box.call(path, body)`.

### 3.3 `backend/app/box/rsa.py`
- `rsa_pubkey`, `rsa_encrypt` (PKCS#1 v1.5). **Sửa khi**: box đổi format key/padding.

### 3.4 `backend/app/box/onvif.py`
- SOAP ONVIF tới camera: `_onvif_digest`, `_ptz_cmd` (move/stop/home/set_home/has_home).
- **Sửa khi**: đổi cách điều khiển PTZ, thêm lệnh ONVIF khác.

### 3.5 `backend/app/box/go2rtc.py`
- Client tới go2rtc `:1984`, watchdog, `sync_streams` (box → stream), `_with_creds`
  (escape `%`→`%25`), `_orphans` (xóa stream mồ côi).
- **Sửa khi**: đổi logic đồng bộ camera, thêm/xóa stream.

### 3.6 `backend/app/box/routes.py`
- Proxy `/aibox/{path}` tới box, channel add/update/delete, discover, sync, ptz.
- **Sửa khi**: thay đổi cách FE thao tác camera/PTZ qua API.

### 3.7 `backend/app/alarm/normalize.py`
- `ALGO_VI` (98 tên tiếng Việt), `TYPES`, `_norm_alarm` (box JSON → event UI),
  `_save_images` (GridFS), `_person_of`, `_images_of`.
- **Sửa khi**: đổi cấu trúc event trả cho FE, đổi tên hiển thị alarm, đổi cách lưu ảnh.

### 3.8 `backend/app/alarm/publish.py`
- `_subs`, `_publish` (SSE broadcast). Spawn thread Telegram qua hook `tg_forward`.
- **Sửa khi**: đổi cách phát realtime tới FE.

### 3.9 `backend/app/alarm/receiver.py`
- `handle_alarm`, `_process_alarm`, `_AREA`, box-recon (`_box_gate`/`_box_recon_drain`).
- **Sửa khi**: đổi cách xử lý alarm đến, đổi chính sách chống "lấy lại hàng cũ".

### 3.10 `backend/app/alarm/routes.py`
- Route HTTP cho alarm: `POST /alarm`, `POST /api/alarms`, `GET /events`, media proxy.
- **Sửa khi**: đổi endpoint FE gọi để lấy alarm/hình/video.

### 3.11 `backend/app/telegram/send.py`
- `_tg_post`/`_tg_post_raw` (multipart + retry 429), `_tg_send_all`, `_tg_targets`.
- **Sửa khi**: đổi cách gửi tin Telegram, filter nhóm nhận alarm.

### 3.12 `backend/app/telegram/caption.py`
- `_tg_caption`, `_tg_image`, `_tg_video`, `_tg_video_url`, `_tg_alarm_log`, `_tg_next_id`.
- **Sửa khi**: đổi nội dung tin alarm gửi Telegram, cách kéo ảnh/clip.

### 3.13 `backend/app/telegram/bot.py`
- `_tg_poll` (long-poll), `_tg_handle_command`, `_tg_countpeople`, `_tg_setup`, `_tg_discover`.
- **Sửa khi**: thêm/sửa lệnh Telegram.

### 3.14 `backend/app/telegram/c27.py`
- Logic chấm công: `_c27_decide`, `_c27_mark`, `_tg_forward`. Cuối file **wire** `publish.tg_forward`.
- **Sửa khi**: đổi quy tắc đồng phục/đi muộn, luật "luôn gửi" (`_C27_ALWAYS`).

### 3.15 `backend/app/api/conn.py`
- `GET/POST /api/conn`, `/api/conn/test`, docking register/info, tgtest, tgsave.
- Port `_docking_register`/`_docking_info`, `conn_info`, `lan_ip`.
- **Sửa khi**: đổi cách lưu cấu hình box/Telegram, đổi logic đăng ký slot alarm.

### 3.16 `backend/app/api/algo.py`
- `/api/algo/all|save`, `/api/hashrate`. **Sửa khi**: đổi cách liệt kê/nạp thuật toán.

### 3.17 `backend/app/api/cameras.py`
- `/api/cameras` (channel/list + smart/enable merged). **Sửa khi**: đổi dữ liệu camera trả FE.

### 3.18 `backend/app/api/tg.py`
- `/api/tg/groups`, `/api/tg/chatname`. **Sửa khi**: đổi cách FE quản lý nhóm Telegram.

### 3.19 `backend/app/db/mongo.py`
- Kết nối MongoDB, index. **Sửa khi**: đổi URI/DB, thêm index.

### 3.20 `backend/app/db/repos.py`
- **Nơi DUY NHẤT thao tác MongoDB.** `AlarmRepo`, `TgAlarmLogRepo`, `TgGroupsRepo`,
  `TgPersonTodayRepo`, `TgPersonLogRepo`, `ConfigRepo`.
- **Sửa khi**: đổi cách đọc/ghi collection, đổi schema lưu trữ. Nếu thêm collection mới →
  thêm repo class ở đây, không viết pymongo ở nơi khác.

### 3.21 `backend/app/mock.py`
- Dữ liệu giả offline (`MOCK_DATA=1`): `mock_cameras`, `mock_alarms`, `mock_algo_all`,
  `mock_conn_info`, `mock_events`. **Sửa khi**: đổi dữ liệu giả cho FE demo.

### 3.22 `backend/app/main.py`
- FastAPI entrypoint: CORS, startup (mongo + threads), mount 7 routers, serve `frontend/dist`
  + `/alarms/{name}`. **Sửa khi**: đổi CORS, thêm router tổng, đổi cách serve tĩnh.

### 3.23 `backend/run.py`
- Chạy uvicorn. **Sửa khi**: đổi cổng/host khởi động.

---

## 4. Chi tiết từng module frontend

### 4.1 `frontend/src/api/client.js`
- Helpers gọi API. `BASE` = origin `:8090`, `G` = go2rtc `:1984`. `jget` = GET json,
  `post` = POST tới `aibox/<path>`.
- **Sửa khi**: đổi cách FE gọi backend, thêm helper API chung.
- ⚠️ `post()` hiện hardcode prefix `aibox/`. Nếu view cần POST thẳng `/api/...` (không qua
  proxy box), dùng `fetch` trực tiếp hoặc thêm hàm mới trong client.js.

### 4.2 `frontend/src/api/useEvents.js`
- Hook `useEvents(onEvent)` lắng nghe `/events` SSE. **Sửa khi**: đổi cách FE nhận alarm realtime.

### 4.3 `frontend/src/hooks/useVideoStream.js`
- Bọc `video-rtc.js`: trả `{ref, state, playMode}` với state
  `connecting|live|retry|error|idle`. **Sửa khi**: đổi logic phát video/retry/stall.

### 4.4 `frontend/src/vendor/video-rtc.js`
- **KHÔNG SỬA** trừ khi sửa transport MSE/WebRTC. Giữ nguyên.

### 4.5 `frontend/src/components/*.jsx`
- VideoTile, TileGrid, Header, Dock. **Sửa khi**: đổi thành phần dùng chung trên mọi view.

### 4.6 `frontend/src/App.jsx`
- Điều hướng view. **Sửa khi**: thêm view mới (xem §6.2), đổi cách chuyển tab.
- Lưu ý: `VIEWS` map có 8 key (`live|detail|log|lib|search|cam|ai|cfg`) nhưng **Dock chỉ
  có 6 nút** — `detail` và `ai` không có nút, `go()` map `detail→live`, `ai→cfg` để nút
  tương ứng sáng lên. Khi thêm view mới nhớ thêm vào cả `VIEWS` (App.jsx) + nút dock
  (Dock.jsx) + (nếu là view phụ) cách mở.

### 4.7 `frontend/src/views/*.jsx`
- 8 view. **Sửa khi**: đổi giao diện/hành vi từng màn hình.

---

## 5. Luồng dữ liệu quan trọng (để sửa đúng chỗ)

### 5.1 Alarm realtime (box → FE + Telegram)
```
box POST /alarm (?slot=N)
  → alarm/routes.py         (parse multipart/JSON, lấy platform)
  → alarm/receiver.handle_alarm → _box_gate (chống hàng cũ)
  → _process_alarm → _save_images (GridFS) → _norm_alarm
     → repos.AlarmRepo.append (MongoDB)   → alarm/publish._publish (SSE)
                                          → thread telegram: c27._tg_forward
```
- **Đổi nơi lưu alarm** → `repos.AlarmRepo` (§3.20).
- **Đổi event gửi FE** → `_norm_alarm` (§3.7).
- **Đổi phát realtime** → `_publish` (§3.8).
- **Đổi tin gửi Telegram** → `caption.py` + `c27.py` (§3.12, 3.14).

### 5.2 FE hiển thị alarm (tab Nhật ký)
```
LogView → POST /api/alarms → alarm/routes.py → repos.AlarmRepo.tail → _norm_alarm → FE
LogView → useEvents(/events) → alarm/publish → render realtime
```

### 5.3 Camera live
```
LiveView → api/client (poll /api/cameras, /api/streams)
VideoTile → useVideoStream → vendor/video-rtc → go2rtc ws://:1984/api/ws?src=chN
```

---

## 6. Hướng dẫn THÊM MỚI (giữ nguyên cấu trúc)

### 6.1 Thêm một endpoint API backend mới

Ví dụ: thêm `POST /api/cameras/toggle` (bật/tắt AI nhanh).

1. **Xác định lớp**: đây là thao tác camera → đặt ở `backend/app/api/cameras.py`.
2. Thêm route vào router có sẵn:

```python
# backend/app/api/cameras.py
@router.post('/api/cameras/toggle')
def toggle_cam(req: dict):
    cid = req.get('channel_id')
    on = req.get('ai_on')
    # gọi box.call(...) nếu cần nói chuyện box
    return {'code': 0, 'msg': 'ok'}
```

3. Nếu cần đọc/ghi MongoDB → dùng `repos` (thêm method vào repo nếu chưa có).
4. Chạy test: `cd backend && python -m pytest tests/ -q`.

> Router đã được mount trong `main.py` — thêm route vào file router có sẵn là đủ,
> không cần sửa `main.py`.

### 6.2 Thêm một view/màn hình FE mới

Ví dụ: thêm tab "Báo cáo".

1. Tạo `frontend/src/views/ReportView.jsx` (default-export component).
2. Vào `frontend/src/App.jsx`, import + thêm vào map `VIEWS`:
```jsx
import ReportView from './views/ReportView.jsx'
const VIEWS = { ..., report: ReportView }        // thêm key 'report'
```
3. **Nếu là tab có nút dock** → thêm vào `frontend/src/components/Dock.jsx` (mảng nút),
   kèm label tiếng Việt + key `'report'`.
   **Nếu là view phụ** (mở từ view khác, không có nút) → thêm cách mở trong view cha
   (vd bấm nút gọi `onOpen('report')` / `go('report')`), và thêm mapping sáng nút trong
   `go()` (App.jsx) nếu muốn nút nào sáng lên.
4. Nếu cần CSS → dùng class có sẵn; chỉ thêm CSS mới khi thật cần.

### 6.3 Thêm một lệnh Telegram mới

Ví dụ: thêm `/temp` trả nhiệt độ.

1. Vào `backend/app/telegram/bot.py`, trong `_tg_handle_command` thêm:
```python
if cmd == '/temp':
    _tg_post('sendMessage', chat, {'text': '32°C'})
    return True
```
2. Nếu lệnh cần state → dùng repos (§3.20).

### 6.4 Thêm một loại dữ liệu lưu MongoDB mới

Ví dụ: lưu "cảnh báo nhiệt độ".

1. Thêm collection + repo class vào `backend/app/db/repos.py`.
2. Thêm index (nếu cần) vào `mongo._ensure_indexes`.
3. Dùng repo đó ở nơi cần (route/alarm/telegram).

### 6.5 Thêm một collection mới

Không cần sửa schema ở nơi khác — `pymongo` tự tạo collection khi ghi. Chỉ cần:
- Thêm repo class trong `repos.py` (để mọi truy cập qua repo).
- (Tùy chọn) thêm index trong `mongo.py`.

---

## 7. Bảng ánh xạ file gốc → file port (đối chiếu khi sửa)

| File gốc (`D:\test\Unv_Smartbox`) | File port |
|---|---|
| `aibox.py` (toàn bộ) | `backend/app/` (chia theo lớp) |
| `aibox.py:76-221` (digest Aibox) | `backend/app/box/client.py` |
| `aibox.py:271-321` (RSA) | `backend/app/box/rsa.py` |
| `aibox.py:325-687` (go2rtc) | `backend/app/box/go2rtc.py` |
| `aibox.py:409-602` (ONVIF/PTZ) | `backend/app/box/onvif.py` |
| `aibox.py:690-752, 1715-1810` (ALGO_VI/normalize) | `backend/app/alarm/normalize.py` |
| `aibox.py:764-785` (SSE publish) | `backend/app/alarm/publish.py` |
| `aibox.py:836-910, 1813-1874` (receiver/recon) | `backend/app/alarm/receiver.py` |
| `aibox.py:1030-1312` (telegram bot) | `backend/app/telegram/bot.py` |
| `aibox.py:1315-1409` (tg send) | `backend/app/telegram/send.py` |
| `aibox.py:1412-1537` (tg caption) | `backend/app/telegram/caption.py` |
| `aibox.py:1539-1712` (c27) | `backend/app/telegram/c27.py` |
| `aibox.py:1878-1955` (docking) | `backend/app/api/conn.py` |
| `aibox.py:1959-2522` (HTTP handler) | `backend/app/*/routes.py` |
| `aibox.py` config/load_conf | `backend/app/config.py` + `db/repos.py` |
| file JSON/jsonl (alarms, tg...) | MongoDB qua `backend/app/db/repos.py` |
| `ui/index.html` (8 view) | `frontend/src/views/*.jsx` |
| `ui/app.js` | `frontend/src/api/client.js` + `App.jsx` + `components/` |
| `ui/ui.js` | `frontend/src/views/*.jsx` (logic per view) |
| `ui/ai.js` | `frontend/src/views/AiView.jsx` |
| `ui/video-stream.js` | `frontend/src/hooks/useVideoStream.js` |
| `ui/video-rtc.js` | `frontend/src/vendor/video-rtc.js` |
| `ui/style.css` | `frontend/src/style.css` |

---

## 8. Test — nơi nào test gì

| Test file | Test gì |
|---|---|
| `backend/tests/test_client.py` | Digest auth, `_parse_challenge` |
| `backend/tests/test_rsa.py` | RSA round-trip, padding |
| `backend/tests/test_go2rtc.py` | `_with_creds` escape, `_orphans` |
| `backend/tests/test_onvif.py` | SOAP envelope |
| `backend/tests/test_normalize.py` | `_norm_alarm` keys, `ALGO_VI` |
| `backend/tests/test_publish.py` | SSE queue drop-old |
| `backend/tests/test_receiver.py` | box-recon gate |
| `backend/tests/test_c27.py` | logic chấm công |
| `backend/tests/test_tg_targets.py` | filter nhóm Telegram |
| `backend/tests/test_mock.py` | mock data shape |
| `backend/tests/test_main.py` | app boot, health, conn |
| `backend/tests/test_routes.py` | các endpoint (MOCK_DATA) |

Khi thêm logic mới ở backend, viết test tương ứng trong `backend/tests/`. Không cần
framework phức tạp — dùng `pytest` + `assert` là đủ.

---

*Tài liệu này đi kèm plan port gốc: `D:\test\Unv_Smartbox\docs\superpowers\plans\2026-09-16-port-react-fastapi-mongodb.md`.*