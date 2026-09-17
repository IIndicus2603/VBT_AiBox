# API Reference — VBT AI SmartBox (Edge Products)

> **Nguồn gốc:** Rút gọn từ `docs/Edge Smart Products API Document-V2.3.9-20260320.pdf`
> (229 trang, IA57XX / ECS-X5X1 / ECS-50XX — AIBox & EIA).
> Tài liệu này là **bản tóm tắt để các session/mọi người gọi API nhanh, đúng**.
> Muốn chi tiết đầy đủ (từng field, bảng ví dụ dài) thì mở PDF gốc.

---

## 0. Giao thức & bảo mật

| Mục | Giá trị |
|---|---|
| Transport | **HTTP** (mọi interface) + **WebSocket** (config + alarm push trên AIBox) |
| Data format | **JSON**, UTF-8 |
| Content-Type | `application/json` |

### WebSocket (tùy chọn thay cho HTTP)
Client gửi: `{ "uri": "/api/v2/search/behavior", "method": "POST", "msgid": "100001", "data": { ...body giống HTTP... } }`
Server trả: `{ "code": 0, "msg": "Succeed", "msgid": "100005", "data": { ...giống HTTP... } }`
→ WebSocket chỉ thêm field `msgid`; phần còn lại **giống hệt HTTP**.

---

## 1. Authentication — BẮT BUỘC (Digest auth)

Mọi request **không kèm header `Authorization`** sẽ bị device trả **401** kèm
`WWW-Authenticate` header chứa: `qop, algorithm, realm, nonce, stale`.

**Quy trình (2 bước):**
1. Gửi request không auth → nhận `401` + thông tin từ `WWW-Authenticate`.
2. Tính digest, gửi lại kèm header `Authorization`.

**Thông tin cần:** `username` + `password` do device cấp (mặc định ví dụ: `admin` / `admin123`).

**Cách tính digest (3 bước):**
```
r1 = hex(md5(username:realm:password))
r2 = hex(md5(method:uri))            # uri là path đầy đủ, vd /api/v2/algo/list
response = hex(md5(r1:nonce:nc:cnonce:qop:r2))
```
- `nc` = nonce counter (vd `00000002`), `cnonce` = chuỗi ngẫu nhiên client sinh.
- `qop` thường là `auth`, `algorithm` thường là `MD5`, `realm` thường là `NVRDVR`.

**Header cuối:**
```
Authorization: Digest username="admin", realm="NVRDVR", nonce="1923473498",
  uri="/api/v2/algo/list", algorithm="MD5", qop=auth, nc=00000002,
  cnonce="1a42d15d190f2f7c93cfe0f749aa4674",
  response="ebaadf53a48e3156cd5a1485b63658b0"
```

> **Lưu ý thực tế (backend dự án này):** code đã bọc sẵn digest auth trong
> `box.call()` / `box.raw()` — không cần tự tính nếu đi qua lớp đó.

---

## 2. Định dạng response chuẩn

Mọi endpoint trả về dạng:
```json
{ "code": 0, "msg": "Succeed", "status_code": 0, "data": { ... } }
```
- `code: 0` = thành công. `code != 0` = lỗi (tra bảng Error Code §10).
- `data` có thể là object, array, hoặc vắng mặt.

---

## 3. Danh mục endpoint (tổng quan 46 API trong PDF)

| # | Path | Method | Nhóm | Mục đích |
|---|---|---|---|---|
| 1 | `/api/v2/personlib/add` | POST | Person Library | Thêm thư viện người |
| 2 | `/api/v2/personlib/delete` | POST | Person Library | Xóa thư viện người |
| 3 | `/api/v2/personlib/update` | POST | Person Library | Sửa thư viện người |
| 4 | `/api/v2/personlib/list` | POST | Person Library | Danh sách thư viện |
| 5 | `/api/v2/person/add` | POST | Person | Thêm 1 người |
| 6 | `/api/v2/person/import` | POST | Person | Thêm người hàng loạt |
| 7 | `/api/v2/person/delete` | POST | Person | Xóa người (nhiều) |
| 8 | `/api/v2/person/update` | POST | Person | Sửa thông tin người |
| 9 | `/api/v2/person/list` | POST | Person | Danh sách người |
| 10 | `/api/v2/rsa/publickey` | POST | Channel | Lấy RSA public key (mã hóa password camera) |
| 11 | `/api/v2/channel/device/info` | POST | Channel | Lấy thông tin stream camera qua Onvif |
| 12 | `/api/v2/channel/add` | POST | Channel | Thêm kênh camera |
| 13 | `/api/v2/channel/delete` | POST | Channel | Xóa kênh |
| 14 | `/api/v2/channel/update` | POST | Channel | Sửa thông tin kênh |
| 15 | `/api/v2/channel/list` | POST | Channel | Danh sách kênh |
| 16 | `/api/v2/channel/import` | POST | Channel | Thêm kênh hàng loạt |
| 17 | `/api/v2/control/time/update` | POST | Arming time | Thêm/sửa thời gian arming |
| 18 | `/api/v2/control/time/get` | POST | Arming time | Lấy thời gian arming |
| 19 | `/api/v2/smart/update` | POST | AI Config | Thêm/sửa task phân tích AI |
| 20 | `/api/v2/smart/list` | POST | AI Config | Danh sách task AI |
| 21 | `/api/v2/algo/list` | POST | AI Config | Danh sách model thuật toán khả dụng |
| 22 | `/api/v2/extend/get` | POST | AI Config | Lấy extension config |
| 23 | `/api/v2/extend/update` | POST | AI Config | Sửa extension config |
| 24 | `/api/v2/smart/params/get` | POST | AI Config | Lấy cấu hình tham số kênh |
| 25 | `/api/v2/smart/params/update` | POST | AI Config | Sửa cấu hình tham số kênh |
| 26 | `/api/v2/smart/task` | POST | AI Config | Bật/tắt task AI (enable/disable) |
| 27 | `/api/v2/smart/cycle` | POST | AI Config | Cấu hình real-time group sequence |
| 28 | `/api/v2/workclotheslib/add` | POST | Work Clothes | Thêm thư viện đồng phục |
| 29 | `/api/v2/workclotheslib/update` | POST | Work Clothes | Sửa thư viện đồng phục |
| 30 | `/api/v2/workclotheslib/delete` | POST | Work Clothes | Xóa thư viện đồng phục |
| 31 | `/api/v2/workclotheslib/list` | POST | Work Clothes | Danh sách thư viện đồng phục |
| 32 | `/api/v2/workclothes/add` | POST | Work Clothes | Thêm 1 bộ đồng phục |
| 33 | `/api/v2/workclothes/batchadd` | POST | Work Clothes | Thêm đồng phục hàng loạt |
| 34 | `/api/v2/workclothes/delete` | POST | Work Clothes | Xóa đồng phục |
| 35 | `/api/v2/workclothes/list` | POST | Work Clothes | Danh sách đồng phục |
| 36 | `/api/v2/device/update` | POST | Device Info | Sửa thông tin thiết bị |
| 37 | `/api/v2/device/get` | POST | Device Info | Lấy thông tin thiết bị |
| 38 | `/api/v2/upgrade` | POST | Upgrade | Upload gói nâng cấp |
| 39 | `/api/v2/upgrade/status` | POST | Upgrade | Trạng thái nâng cấp |
| 40 | `/api/v2/search/behavior` | POST | Data Search | Tìm dữ liệu behavior analysis |
| 41 | `/api/v2/search/facecap` | POST | Data Search | Tìm dữ liệu face snapshot |
| 42 | `/api/v2/search/behaviormatch` | POST | Data Search | Tìm behavior + face comparison |
| 43 | `/api/v2/search/facematch` | POST | Data Search | Tìm face comparison |
| 44 | `/api/v2/search/line/start` | POST | Data Search | Bắt đầu đếm người qua line (async) |
| 45 | `/api/v2/search/line/progress` | POST | Data Search | Tiến độ đếm người |
| 46 | `/api/v2/search/line/result` | POST | Data Search | Kết quả đếm người |
| 47 | `/api/v2/search/line/stop` | POST | Data Search | Dừng đếm người |
| 48 | `/api/v2/docking/config/update` | POST | Platform Integration | Thêm/sửa cấu hình tích hợp nền tảng (nhận alarm push) |
| 49 | `/api/v2/docking/config/get` | POST | Platform Integration | Lấy cấu hình tích hợp |
| 50 | `/api/v2/docking/ability/get` | POST | Platform Integration | Lấy khả năng tích hợp |

---

## 4. Nhóm Person Library (§2)

### 4.1 Thêm thư viện — `POST /api/v2/personlib/add`
Body: `{ "lib_name": "test2" }` (bắt buộc, ≤64 ký tự)
Trả về: `data.lib_id` (ID thư viện mới).
Lỗi: `400004` param sai, `400938` trùng tên, `400921` thêm thất bại.

### 4.2 Xóa thư viện — `POST /api/v2/personlib/delete`
Body: `{ "lib_id": 5 }`
### 4.3 Sửa thư viện — `POST /api/v2/personlib/update`
Body: `{ "lib_id": 5, "lib_name": "newName" }`
### 4.4 Danh sách thư viện — `POST /api/v2/personlib/list`
Body: `{ "page": 1, "pagesize": 10 }` → `data.list[]` chứa `{lib_id, lib_name, person_count, ...}`.

---

## 5. Nhóm Person (§3)

### 5.1 Thêm 1 người — `POST /api/v2/person/add`
Body:
```json
{
  "person_name": "Nguyen A",      // bắt buộc, ≤64
  "image_base64": "<base64 ảnh mặt>",  // bắt buộc
  "sex": 1,                        // 1 nam, 2 nữ, 99 khác
  "email": "", "tel": "",
  "certificate_type": 1,           // 1 CMND, 2 hộ chiếu, 3 bằng lái, 99 khác
  "certificate_no": "", "birth_date": "",
  "lib_id": 5                      // bắt buộc — ID thư viện người
}
```

### 5.2 Thêm hàng loạt — `POST /api/v2/person/import`
Body chứa array các người (mỗi phần tử như `person/add`), thường kèm `lib_id`.

### 5.3 Xóa người — `POST /api/v2/person/delete`
Body: `{ "person_id": [1, 2, 3] }` (mảng ID, hoặc nhiều field nhận dạng).

### 5.4 Sửa người — `POST /api/v2/person/update`
Body: `{ "person_id": 1, "person_name": "...", ... }` (các field giống add).

### 5.5 Danh sách người — `POST /api/v2/person/list`
Body: `{ "page": 1, "pagesize": 10, "lib_id": 5 }`
→ `data.list[]` chứa `{person_id, person_name, sex, image_path, ...}`.

---

## 6. Nhóm Channel — Camera (§4)

### 6.1 Lấy RSA public key — `POST /api/v2/rsa/publickey`
Body rỗng `{}` → `data.public_key`. **Dùng để mã hóa password camera** (`pwd`) trước khi gửi `channel/add`/`update`.

### 6.2 Lấy thông tin stream qua Onvif — `POST /api/v2/channel/device/info`
Body: `{ "ip": "...", "port": 80, "username": "admin", "pwd": "<rsa>", "type": 1 }`
→ trả danh sách stream (dùng để lấy `video_id` cho custom stream).

### 6.3 Thêm kênh — `POST /api/v2/channel/add`
```json
{
  "type": 1,                  // 1 = onvif, 2 = rtsp
  "transport_type": 1,        // 1 tcp, 2 udp, 3 lapi
  "channel_name": "Camera",   // bắt buộc
  "rtsp": "rtsp://217.1.0.143/media/video1",  // bắt buộc nếu type=2
  "ip": "217.1.0.143",        // bắt buộc nếu type=1 (onvif)
  "port": 80,
  "username": "admin",
  "pwd": "<rsa-encrypted>",   // RSA-encrypted
  "video_type": 1,            // 1 main, 2 custom, 3 third (LAPI)
  "video_id": 0,              // bắt buộc khi custom stream
  "custom_code": "",
  "serialnumber": "", "manufacturer": "", "model": ""
}
```
→ `data.channel_id` (ID kênh mới).

### 6.4 Xóa kênh — `POST /api/v2/channel/delete`
Body: `{ "channel_id": 1 }`

### 6.5 Sửa kênh — `POST /api/v2/channel/update`
Body: `{ "channel_id": 1, "channel_name": "...", ... }`

### 6.6 Danh sách kênh — `POST /api/v2/channel/list`
Body: `{ "page": 1, "pagesize": 100 }`
→ `data.list[]` chứa `{channel_id, channel_name, ip, type, online_status, ...}`. **Đây là endpoint cốt lõi để liệt kê camera.**

### 6.7 Thêm kênh hàng loạt — `POST /api/v2/channel/import`
Body: mảng các kênh (giống `channel/add`), thường kèm tên file ảnh thumbnail.

---

## 7. Nhóm Arming Time (§5)

### 7.1 Thêm/sửa — `POST /api/v2/control/time/update`
Body: `{ "channel_id": 1, "arm_time": [ { ... thời gian ... } ] }` (cấu hình lịch bật/tắt giám sát theo giờ).
### 7.2 Lấy — `POST /api/v2/control/time/get`
Body: `{ "channel_id": 1 }`

---

## 8. Nhóm AI Config — Phân tích thông minh (§6)

### 8.1 Thêm/sửa task AI — `POST /api/v2/smart/update`
Đây là API **phức tạp nhất**, cấu hình model thuật toán trên từng kênh.
Body dạng:
```json
{
  "channel_id": 1,
  "smart_list": [
    {
      "algo_model": "FireDetection",   // tên model, xem §8.3
      "sensitive": 50,                  // độ nhạy 1-100
      "report_rate": 5,                 // khoảng cách báo alarm (s)
      "time_threshold": 10,             // ngưỡng thời gian (s)
      "object_type": [1, 2, 3],         // loại đối tượng xâm nhập
      "direction_line": "",             // đường/line báo động
      "person_num_limit": 0,
      "person_float_limit": 0,
      "back_time_threshold": 0,
      "line_dpc_enable": 0, "line_dpc_time": 0,
      "detour_area": 0
    }
  ]
}
```
- Các field trong `smart_list[i]` phụ thuộc model (chỉ gửi field model đó hỗ trợ).
- `channel_id` xác định kênh áp dụng.

**Model đặc biệt — Fuel unloading** (tên service riêng): `TankerParking`, `SafetyParking`,
`SafetyOperation`, `SafetyEquipment`, `TubingConnection`, `PersonOnDuty`, `TubingDisconnection`.

### 8.2 Danh sách task AI — `POST /api/v2/smart/list`
Body: `{ "channel_id": 1 }` → `data.smart_list[]` (cấu hình AI hiện tại của kênh).

### 8.3 Danh sách model thuật toán — `POST /api/v2/algo/list`
Body rỗng `{}` → `data.algo_model[]`. Một số model mẫu:
```
ObjectIsRecognized, FieldDetectorObjectsInside, LineRuleData, AreaRuleData,
AccessElevatorAlarm, ObjectRemoved, SafetyHelmetAlarm, WorkClothesAlarm,
TelephoningAlarm, NoMaskAlarm, FallOverAlarm, OffDutyDetectionAlarm,
SleepingDetectionAlarm, ReflectiveClothesDetectionAlarm, SmokingAlarm,
PlayMobilePhoneDetection, FireDetection, FumesAlarmBegin,
CrowdDensityCriticalAlarm, AbnormalParkingDetection, ChannelBlockageDetection
```

### 8.4 Extension config — `POST /api/v2/extend/get` (get) & `/api/v2/extend/update` (update)
Cấu hình mở rộng hệ thống (các tham số chung). Body `extend/update` chứa object cấu hình cần set.

### 8.5 Tham số kênh — `POST /api/v2/smart/params/get` & `/api/v2/smart/params/update`
Body: `{ "channel_id": 1 }` → lấy/sửa cấu hình tham số AI của 1 kênh.

### 8.6 Bật/tắt task AI — `POST /api/v2/smart/task`
```json
{ "channel_id": 1, "status": 1 }   // 1 = bật, 0 = tắt
```

### 8.7 Real-time group sequence — `POST /api/v2/smart/cycle`
Body: `{ "channel_id": 1, ... }` — cấu hình thứ tự xoay vòng các kênh hiển thị real-time.

---

## 9. Nhóm Work Clothes — Đồng phục (§7–§8)

- **Thư viện đồng phục** (lib): `add`, `update`, `delete`, `list` trên `/api/v2/workclotheslib/*`. Body: `{ "lib_name": "..." }`, `list` → `data.list[]`.
- **Đồng phục** (item): `add` (1 bộ), `batchadd` (hàng loạt), `delete`, `list` trên `/api/v2/workclothes/*`. Body `add`: `{ "lib_id": 1, "workclothes_name": "...", "image_base64": "<ảnh>" }`.

---

## 10. Nhóm Device Info (§9)

### 10.1 Lấy thông tin thiết bị — `POST /api/v2/device/get`
Body rỗng `{}` → `data`:
```json
{
  "device_name": "AIBox", "device_model": "ECS-X5X1",
  "serial_number": "...", "firmware_version": "V2.3.9",
  "release_time": 1234567890, "device_code": 1, "custom_code": ""
}
```
### 10.2 Sửa thông tin — `POST /api/v2/device/update`
Body: `{ "device_name": "...", "custom_code": "..." }` (các field muốn đổi).

---

## 11. Nhóm Upgrade (§10)

### 11.1 Upload gói — `POST /api/v2/upgrade`
Body dạng multipart/form-data chứa file firmware (không phải JSON). Vd `{ "file": "<bin>" }`.
### 11.2 Trạng thái — `POST /api/v2/upgrade/status`
Body rỗng `{}` → `data` chứa trạng thái tiến trình nâng cấp.

---

## 12. Nhóm Data Search (§11) — QUAN TRỌNG cho hiển thị alarm

### 12.1 Tìm behavior analysis — `POST /api/v2/search/behavior`
Body:
```json
{
  "page": 1, "pagesize": 100,          // bắt buộc
  "channel_id": [1,2,3],               // bắt buộc
  "algo_model": ["FireDetection", "SmokingAlarm"],  // rỗng = tìm tất cả
  "start_time": 1743523200,            // bắt buộc, 10-chữ số giây
  "end_time": 1743609600,              // bắt buộc
  "compare_flag": 1,                   // 1 all, 2 compare
  "object_type": [1,2,3],              // 1 người, 2 ô tô, 3 xe máy, 5+ động vật
  "plate_no": "", "vehicle_status": 999,
  "gauge_status": [], "coal_quantity": [], "ship_type": []
}
```
→ `data`:
```json
{
  "total": 5,
  "list": [
    {
      "alarm_id": 1, "big_picture_url": "/api/v2/smart/picture?..." ,
      "algo_model": "FireDetection", "capture_time": 1743530000,
      "channel_id": 1, "channel_name": "Camera",
      "video_url": "/api/v2/smart/video?...", "object_list": []
    }
  ]
}
```
Các field alarm: `alarm_id, big_picture_url, algo_model, capture_time, channel_id, channel_name,
preset_id/name, gauge_status, coal_quantity, circuit_breaker_status, pressure_gauge_scale,
ocr_result, indicator_light_info{color,status}, video_url, object_list[{speed, vehicle_status, object_type,...}]`.

### 12.2 Tìm face snapshot — `POST /api/v2/search/facecap`
Body tương tự `search/behavior` nhưng filter theo người/khuôn mặt → `data.list[]` chứa ảnh khuôn mặt, thông tin người match.

### 12.3 Tìm behavior + face so sánh — `POST /api/v2/search/behaviormatch`
Kết hợp behavior alarm + kết quả nhận diện khuôn mặt. Body thêm field match.

### 12.4 Tìm face so sánh — `POST /api/v2/search/facematch`
Filter theo `person_id`, `lib_id`, `similarity` → danh sách ảnh mặt match với người trong thư viện.

### 12.5–12.8 Đếm người qua line (bất đồng bộ) — `/api/v2/search/line/*`
- **start**: `POST /api/v2/search/line/start` → `data.search_id`. Body chứa `channel_id`, `start_time`, `end_time`, line config.
- **progress**: `POST /api/v2/search/line/progress` body `{ "search_id": 1 }` → tiến độ %.
- **result**: `POST /api/v2/search/line/result` body `{ "search_id": 1 }` → kết quả đếm (in/out).
- **stop**: `POST /api/v2/search/line/stop` body `{ "search_id": 1 }` → dừng.

> ⚠️ Đếm người qua line là **bất đồng bộ**: start → poll progress → lấy result. Không phải call 1 phát có ngay.

---

## 13. Nhóm Platform Integration (§12) — CẤU HÌNH NHẬN ALARM PUSH

### 13.1 Thêm/sửa cấu hình — `POST /api/v2/docking/config/update`
Đây là API để **device biết push alarm về đâu** (HTTP/HTTPS/WS). Body:
```json
{
  "platform": [
    {
      "id": 0,                    // 0 hoặc 1 (tối đa 2 platform)
      "version_code": "2.0",      // version interface
      "enabled": 1,               // 1 bật, 0 tắt
      "url": "http://your-server/alarm",   // địa chỉ nhận alarm
      "picture_enable": 1,        // 1 gửi ảnh
      "video_enable": 1,          // 1 gửi video
      "fuel_report_mode": 1,      // 1 tách, 2 gộp (fuel unloading)
      "pdf_enable": 0,
      "http_alive": 1,            // keep-alive
      "alive_interval": 60        // giây, 30-600
    }
  ]
}
```

### 13.2 Lấy cấu hình — `POST /api/v2/docking/config/get`
Body rỗng `{}` → `data.platform[]`.

### 13.3 Khả năng tích hợp — `POST /api/v2/docking/ability/get`
Body rỗng `{}` → `data` mô tả capability (hỗ trợ protocol nào, field nào).

---

## 14. Alarm Push (Data Reporting §13) — DEVICE → SERVER

Device **chủ động POST** alarm về URL đã cấu hình ở §13 (HTTP/HTTPS/WS). Đây là phần backend nhận, không phải API frontend gọi.

**Endpoint đích:** `http://ip:port/<url>` / `ws://ip:port/<url>` — URL do bạn set trong `docking/config/update`.
**Method:** POST, JSON.

**Body gửi tới:** field `type` phân loại nội dung:
| type | Nội dung |
|---|---|
| 1 | Behavior analysis alarm data |
| 2 | Alarm reset data |
| 3 | Face snapshot data |
| 4 | Face comparison data |
| 5 | Behavior comparison data |
| 6 | Keep-alive data |
| 7 | Channel change data |

**Cấu trúc chung:**
```json
{
  "type": 1, "event_id": "alarm-001", "has_result": 1,
  "device_info": { "device_code": 1, "device_name": "AIBox", "device_sn": "...", "custom_code": "" },
  "channel_info": { "mode": 1, "ipc_sn": "", "ipc_addr": "", "channel_id": 1, "channel_name": "Camera", "status": 1, "custom_code": "" },
  "behaviour": {
    "algo_model": "FireDetection", "image_base64": "<ảnh>", "image_path": "/xx",
    "capture_time": 1743530000, "in_num": 1, "out_num": 0, "area_num": 3,
    "video_uuid": "...", "video_url": "/api/v2/smart/video?...",
    "capture_info": [ { "target_id": 1, "point_x": 0, "point_y": 0, ... } ]
  }
}
```
- `behaviour` chứa chi tiết alarm (chỉ có khi `type` liên quan behavior/face).
- `image_base64` có thể rất lớn — server nên xử lý gọn.

**Kiểu alarm (behavior data) field phụ thuộc model:** `gauge_status`, `coal_quantity`, `circuit_breaker_status`, `pressure_gauge_scale`, `ocr_result`, `indicator_light_info`, `in_num/out_num/area_num` (tripwire).

### Alarm Video / Picture
- Alarm có `video_url` dạng `/api/v2/smart/video?ChlId=..&StartTime=..&EndTime=..` → để kéo clip về.
- Ảnh alarm có `big_picture_url` / `image_path` dạng `/api/v2/smart/picture?...`.

---

## 15. Appendix: Error Code (§14.1) — các mã hay gặp

| Code | Ý nghĩa |
|---|---|
| `0` | Succeed |
| `1` | Common Error |
| `2` | Invalid Arguments |
| `3` | Not Authorized |
| `4` | Not Supported |
| `5` | Abnormal User Status |
| `6` | System Busy |
| `1000-1004` | Auth: sai user/pass, không quyền, quá số login, IP bị khóa |
| `1100-1101` | Face lib: quá giới hạn, trùng tên |
| `1200-1218` | Face: quá giới hạn, sai ID, sai ảnh, lỗi nhập |
| `1500` | AI: loại thuật toán không hỗ trợ config đồng thời |
| `1600-1601` | Workclothes lib: trùng tên, quá giới hạn |
| `1700-1702` | Workclothes: quá giới hạn, ảnh quá lớn, lỗi import |
| `1800-1801` | Device info: lỗi lấy/set thông tin |
| `1900-1906` | Upgrade: lỗi nâng cấp, sai file/version, lỗi chữ ký |
| `2000` | Data search |
| `2100` | Platform connection |
| `2200` | Data reporting |
| `400004` | Invalid parameter |
| `400365` | Lỗi lấy danh sách operator type |
| `400921` | Thêm person library thất bại |
| `400938` | Trùng tên person library |

> Chi tiết đầy đủ error code per-endpoint nằm trong mục "Return Data" của từng API trong PDF.

---

## 16. Applicable Products (§14.2)
- IA57XX
- ECS-X5X1, ECS-X5X1-SF
- ECS-50XX, ECS-50XX-SF

---

## ⚠️ Ghi chú các endpoint bổ sung KHÔNG có trong PDF

Code backend/frontend dự án này còn gọi các path sau **không được mô tả trong tài liệu gốc**
(device hỗ trợ nhưng không ghi trong bản PDF này):

| Path | Dùng để |
|---|---|
| `GET /api/v2/smart/picture?<query>` | Lấy ảnh alarm (từ `big_picture_url`/`image_path`) |
| `GET /api/v2/smart/video?ChlId=..&StartTime=..&EndTime=..` | Lấy clip alarm |
| `POST /api/v2/smart/enable/list` | Danh sách kênh + model AI đang bật |
| `POST /api/v2/algo/list/current` | Danh sách model AI đang active |
| `POST /api/v2/smart/hashinfo/get` | Lấy hash trạng thái cấu hình AI (so sánh thay đổi) |
| `POST /api/v2/algo/capabilities` | Lấy capability của từng model AI |

Nếu cần dùng chính xác các path này, phải tự probe device (gọi thử) hoặc xem code backend đã dùng — không có spec trong PDF.

---

## Mẹo nhanh cho session khác

1. **Luôn gọi qua `box.call()` / `box.raw()`** của backend — đã bọc sẵn digest auth, không tự tính.
2. **Muốn biết có camera nào:** `POST /api/v2/channel/list` với `{page, pagesize}`.
3. **Muốn xem alarm lịch sử:** `POST /api/v2/search/behavior` với `channel_id`, `start_time`, `end_time` (timestamp 10 số giây).
4. **Muốn nhận alarm realtime:** cấu hình `POST /api/v2/docking/config/update` trỏ `url` về server mình, rồi server nhận POST ở path đó.
5. **Muốn kéo ảnh/clip alarm:** dùng `GET /api/v2/smart/picture` hoặc `GET /api/v2/smart/video` với query từ `big_picture_url`/`video_url`.
6. **Tất cả thời gian là timestamp giây 10 chữ số**, không phải mili giây.
7. **`code: 0` = OK.** Lỗi khác → tra §15.