# API cấu hình AI theo từng camera — cách tìm và cách nối

Tài liệu cho session khác nối tiếp. Mọi endpoint dưới đây **đã probe thật** trên
box `ECS-516S-SF-HD` (firmware tại 192.168.21.93), không phải suy từ tài liệu.

## 0. Vì sao phải tự dò

Tài liệu PDF chính thức (`Edge_Smart_Products_API_Document-V2.3.9`, 163 trang, 54
endpoint) **KHÔNG có** phần lịch trình, liên kết, công suất, danh sách thuật toán
đang nạp. Web UI của box vẫn làm được các việc đó → endpoint tồn tại nhưng không
được ghi tài liệu.

## 1. Cách tìm endpoint không có trong tài liệu

Web UI của box là SPA. Toàn bộ tên endpoint nằm trần trong bundle JS của nó.

```bash
# 1. Tải bundle JS của box (đường dẫn lấy từ view-source của trang box)
curl -s http://<box-ip>/assets/index.js -o _boxui/index.js     # ~2.5 MB

# 2. Liệt kê MỌI endpoint box biết
grep -oh "/api/v2/[a-zA-Z0-9/_.-]*" _boxui/*.js | sort -u

# 3. Tìm tên hàm quanh endpoint -> biết endpoint dùng để làm gì
grep -o ".\{200\}/api/v2/linkage/.\{240\}" _boxui/index.js
```

Bước 3 là bước quan trọng nhất. Bundle bị minify nhưng **object khai báo API vẫn
giữ tên hàm gốc**, nên đọc được ý nghĩa từng endpoint:

```js
setRule:        e => post("/api/v2/smart/update", e),
getLinkageCfg:  e => post("/api/v2/linkage/get", e),
setLinkageCfg:  e => post("/api/v2/linkage/update", e),
getWeekPlan:    e => post("/api/v2/control/time/get", e),
setWeekPlan:    e => post("/api/v2/control/time/update", e),
getAlarmParams: e => post("/api/v2/smart/params/get", e),
```

## 2. Cách dò body khi không biết body

Box trả `code 2 / status_code 60006 = Invalid Arguments` khi thiếu field, và
`code 0` khi đủ. Dùng chính điều đó để dò — thử từ body rỗng rồi thêm dần field:

```bash
try() { curl -s -X POST http://127.0.0.1:8090/aibox/$1 \
          -H 'Content-Type: application/json' -d "$2"; }

try control/time/get '{}'                                    # code 2  <- thiếu field
try control/time/get '{"channel_id":1}'                      # code 2  <- vẫn thiếu
try control/time/get '{"channel_id":1,"algo_model":"FieldDetectorObjectsInside"}'
                                                             # code 0  <- ĐỦ
```

**Kết luận quan trọng:** lịch trình và liên kết **không thuộc camera**, mà thuộc
cặp *(camera, thuật toán)*. Mỗi thuật toán trên cùng 1 camera có lịch riêng, liên
kết riêng. Thiếu `algo_model` là lý do duy nhất gây `Invalid Arguments` ở đây.

Gọi qua `/aibox/<path>` là proxy của `aibox.py` (tự lo digest auth) — đừng gọi
thẳng vào box bằng curl vì sẽ vướng digest MD5.

## 3. Ba tab cấu hình AI — endpoint và payload thật

Mọi response dưới đây copy nguyên từ box, không rút gọn.

### 3.1 Tab Quy tắc — `/api/v2/smart/update`

Đã nối trong `ai.js`. Vùng ROI dùng toạ độ 0~10000, `point_x`/`point_y` là
**chuỗi CSV** chứ không phải array: `{"point_x": "1000,9000", "point_y": "500,8000"}`.

Tham số mặc định của cả 94 thuật toán: `/api/v2/smart/default/param`.
Tham số cảnh báo chung: `/api/v2/smart/params/get` (body `{channel_id}`):

```json
{"alarm_video_param": {"status":1,"befor_alarmed_time":5,"after_alarmed_time":5},
 "face_param": {"min_width":30,"min_height":30,"filter_mode":0,
                "prefer_last_time":30,"interval_time":2,"face_quality":0},
 "status_recovery_param": {"status":0}}
```

`befor_alarmed_time` viết sai chính tả trong firmware (thiếu chữ `e`). Đừng sửa.

### 3.2 Tab Lịch trình — `/api/v2/control/time/get` · `/update`

Body: `{"channel_id": 1, "algo_model": "FieldDetectorObjectsInside"}`

```json
{"monday":    [{"start": "00:00", "end": "24:00"}],
 "tuesday":   [{"start": "00:00", "end": "24:00"}],
 "wednesday": [{"start": "00:00", "end": "24:00"}],
 "thursday":  [{"start": "00:00", "end": "24:00"}],
 "friday":    [{"start": "00:00", "end": "24:00"}],
 "saturday":  [{"start": "00:00", "end": "24:00"}],
 "sunday":    [{"start": "00:00", "end": "24:00"}]}
```

Ghi chú khi dựng lưới 7×24:
- Key là **tên thứ tiếng Anh chữ thường**, không phải số 0-6.
- Mỗi ngày là **mảng nhiều khoảng**, không phải 1 khoảng → chọn 8-12h và 14-18h
  thì gửi 2 phần tử.
- `"24:00"` là hợp lệ và nghĩa là hết ngày. Đừng đổi thành `"23:59"`.
- Lưới 7×24 ô của design là *cách hiển thị*; khi lưu phải gộp các ô liền nhau
  thành khoảng `{start, end}`.

### 3.3 Tab Liên kết — `/api/v2/linkage/get` · `/update`

Body: `{"channel_id": 1, "algo_model": "FieldDetectorObjectsInside"}`

```json
{"linkage": {
  "output": [{"ID":1,"Enable":0},{"ID":2,"Enable":0},
             {"ID":3,"Enable":0},{"ID":4,"Enable":0}],
  "sound_linkage": {"enable":0,"warn_cnt":1,"volume":8,
                    "ipc_enable":0,"ipc_warn_cnt":1},
  "email_linkage": [{"enable":0,"id":1,"address":""}, … 6 phần tử]}}
```

- `output` = 4 cổng báo động vật lý của box. `ID` và `Enable` **viết hoa chữ đầu**,
  trong khi `sound_linkage`/`email_linkage` viết thường. Firmware không nhất quán.
- `sound_linkage.volume` 0~10, `warn_cnt` = số lần phát lại.
- `ipc_enable` = phát loa trên **camera**, khác `enable` = loa trên **box**.

### 3.4 Popup / giọng nói theo camera — `/api/v2/linkage/web/get` · `/update`

Body rỗng `{}`. Trả về **cả 16 kênh một lượt** (không cần `algo_model`):

```json
{"linkage_web_cfg": [{"channel_id":1,"popup_enable":1,"voice_enable":0}, …]}
```

## 4. Khung phát hiện vẽ trên video (overlay)

Box đã đẩy sẵn toạ độ vật thể trong mỗi cảnh báo POST về `/alarm`. Nằm ở
`behaviour.capture_info[]` (hoặc `face.capture_info[]`):

```json
[{"point_x": "8779,9616", "point_y": "8203,9953",
  "plate_no": "", "speed": 0, "target_id": 1, "object_type": 1}]
```

- 2 điểm = góc trên-trái và góc dưới-phải, thang **0~10000** (giống ROI).
  Đổi sang % để vẽ: `left = 8779/100 = 87.79%`.
- `target_id` để theo dõi cùng một vật qua nhiều cảnh báo.
- `object_type` phân loại vật (1 = người, theo dữ liệu quan sát được).
- `plate_no`/`speed` chỉ có giá trị với thuật toán biển số / giao thông.

Đây là **vị trí vật thể lúc phát hiện**, khác với vùng ROI do người dùng vẽ:
ROI cố định, khung này di chuyển theo vật và chỉ có khi đang có cảnh báo.

## 5. Bảng camera — hai cột box không trả

Design có cột *Khu vực* và *Độ trễ*, box không có field nào tương ứng:

- **Khu vực**: dùng `channel_name` từ `/api/v2/channel/list` (người dùng đặt tên
  kênh trên box, thường là chính vị trí).
- **Độ trễ**: lấy phía go2rtc, không phải từ box —
  `pc.getStats()` → `candidate-pair.currentRoundTripTime` (đã có trong `app.js`,
  hàm `sampleRtt`), hoặc bitrate từ `/api/streams`.

## 6. Bẫy đã gặp, đừng lặp lại

| Triệu chứng | Nguyên nhân thật |
|---|---|
| `code 2 Invalid Arguments` ở time/linkage | Thiếu `algo_model` (không phải sai `channel_id`) |
| Request thứ 2 trả `501 Unsupported method` | `do_POST` không đọc hết body → HTTP/1.1 keep-alive parse byte body thành request-line kế tiếp. Phải drain body trước khi route |
| Sửa JS xong reload vẫn chạy code cũ | Browser cache ES module rất dai. `Cache-Control: no-store` chưa đủ, `location.reload()` cũng không refetch module — phải đổi URL (`/?v=<timestamp>`) |
| `/algo/list` "rỗng" | Field là `data.algo_model`, không phải `data.list` |
| Ảnh cảnh báo hiện được thì trang chết | `self.directory` là state của CONNECTION, không được gán trong `do_GET` — dùng `translate_path()` |
