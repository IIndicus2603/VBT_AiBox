# Chỉ mục API AIBOX — làm task gì thì gọi endpoint nào

Đọc file này TRƯỚC. Nó chỉ trả lời một câu: *task này dùng endpoint nào, chi tiết nằm ở đâu*.
Không lặp lại payload — payload nằm ở 2 file kia.

| File | Nội dung |
|---|---|
| `API_INDEX.md` (file này) | Bảng tra task → endpoint. Quy ước gọi. |
| `KEHOACH_API.md` | Digest auth, envelope, RSA, thứ tự bắt buộc, nhận alarm. Nguồn: PDF chính thức. |
| `API_CAUHINH_AI.md` | Payload thật của cấu hình AI (quy tắc / lịch / liên kết), cách tự dò endpoint. Nguồn: probe thiết bị thật. |
| `_apidoc.txt` | Text bóc từ PDF 229 trang — grep khi cần bảng tham số gốc. |
| `_extract.json` | 11 chương đã tóm tắt có cấu trúc (`section`/`endpoints`/`mechanics`/`order_of_ops`). Đọc bằng python, đừng cat. |
| `aibox.py` | Bridge đang chạy: digest proxy + alarm receiver + sync go2rtc. |

## Quy ước gọi — 3 điều bắt buộc nhớ

1. **Mọi endpoint là `POST /api/v2/...`, body JSON**, kể cả các endpoint "get". Ngoại lệ là mấy
   cái lấy file bằng `GET`: `/api/v2/smart/picture`, `/api/v2/smart/video` (bridge proxy sẵn 2 cái
   này), và `/api/v2/sound/audio/?alarmaudio=<tên>.wav` — tải wav cảnh báo, chỉ có trong bundle JS.
   Upload âm thanh thì vẫn POST: `sound/audio/file`.
2. **Đừng curl thẳng vào box** — vướng Digest MD5. Gọi qua bridge:
   `POST http://127.0.0.1:8090/aibox/<path sau /api/v2/>`. Ví dụ `/aibox/algo/list`.
   Bridge tự lo digest, nonce, retry 401. Chi tiết digest ở `KEHOACH_API.md` §1.
3. **Envelope**: `{"code":0,"msg":"Succeed","status_code":0,"data":{...}}`. `code == 0` là OK.
   `code 2` = Invalid Arguments = **thiếu field**, thường là thiếu `algo_model`.

---

## 1. Kết nối / thông tin thiết bị

| Task | Endpoint | Ghi chú |
|---|---|---|
| Test kết nối, đọc model/serial/firmware | `device/get` | Body rỗng. Dùng làm health check. |
| Đổi tên box, device ID, custom code | `device/update` | |
| Lấy public key để mã hoá mật khẩu camera | `rsa/publickey` | Body rỗng (POST không body). Chỉ cần khi thêm camera bằng ONVIF (`type=1`). |
| Nâng cấp firmware | `upgrade` rồi poll `upgrade/status` | `upgrade/status` dùng `x-www-form-urlencoded`, không phải JSON. |

## 2. Camera / channel

| Task | Endpoint | Ghi chú |
|---|---|---|
| Liệt kê camera | `channel/list` | Body `{page, pagesize, channel_name}` → `data.channel_list`. |
| Dò camera qua ONVIF (lấy RTSP) | `channel/device/info` | `pwd` phải RSA-encrypt bằng key ở trên. |
| Thêm 1 camera | `channel/add` | → `data.channel_id`. `type=1` onvif, `type=2` rtsp trực tiếp. |
| Thêm nhiều camera | `channel/import` | Chỉ trả `fail_list` — muốn biết id phải gọi `channel/list` sau. |
| Sửa camera | `channel/update` | Đổi tên thôi thì có `channel/name/update` (nhẹ hơn). |
| Xoá camera | `channel/delete` | Body `{channel_id_list: [..]}`. |

**Thứ tự bắt buộc — chỉ khi thêm bằng ONVIF (`type=1`)**: `rsa/publickey` → encrypt pwd →
`channel/device/info` (chỉ cần khi `video_type=2`, để lấy `video_id`) → `channel/add`.
Với `type=2` (rtsp trực tiếp) gọi thẳng `channel/add` kèm `rtsp` — không cần RSA, không cần
`channel/device/info`. Toàn bộ channel đang có trên box đều là `type=2`. Đầy đủ ở `KEHOACH_API.md` §3.
Trong repo đã có sẵn: `POST /api/channel/add` của bridge — nhưng chỉ đi đường ONVIF
(hardcode `type:1`, bắt buộc có `ip`).

## 3. Cấu hình AI cho camera

| Task | Endpoint | Ghi chú |
|---|---|---|
| Xem box hỗ trợ thuật toán nào (94) | `algo/list` | Trả `data.algo_model` (KHÔNG phải `data.list`). Đừng hardcode. |
| Thuật toán đang nạp trên box (14) | `algo/list/current` | Không có trong PDF. |
| Công suất khi áp 1 bộ algo | `smart/hashinfo/get` | Body `{channel_id, algo_model:[]}`. Max 20 algo. |
| Bật/tắt AI cho 1 channel | `smart/task` | `{channel_id, status: 1|0}`. **Phải bật trước khi cấu hình.** |
| Kênh nào đang bật AI gì | `smart/enable/list` | `data` là **array** 16 kênh, không phải object. |
| Đọc/ghi quy tắc + vùng ROI | `smart/list` / `smart/update` | **GHI ĐÈ TOÀN BỘ list** — read-modify-write. |
| Tham số mặc định của thuật toán | `smart/default/param` | Dùng để prefill form. |
| Tham số cảnh báo chung (clip, face filter) | `smart/params/get` / `params/update` | |
| Độ nhạy + interval báo lại | `extend/get` / `extend/update` | Bất đối xứng key: get dùng `smart_list`, update dùng `list`. |
| Lịch canh 7×24 | `control/time/get` / `update` | Body **bắt buộc** `{channel_id, algo_model}`. |
| Liên kết (còi, email, output) | `linkage/get` / `update` | Cũng bắt buộc `algo_model`. |
| Popup + giọng nói theo kênh | `linkage/web/get` / `update` | Body rỗng, trả cả 16 kênh một lượt. |
| Real-time hay round-robin | `smart/cycle` | |

**Điểm dễ sai nhất**: lịch trình và liên kết thuộc cặp *(channel, algo_model)*, không thuộc camera.
Thiếu `algo_model` → `code 2`. Payload thật (ROI dạng CSV `"1000,9000"`, key thứ tiếng Anh,
`"24:00"` hợp lệ) xem `API_CAUHINH_AI.md` §3.

## 4. Thư viện mặt / đồng phục

| Task | Endpoint |
|---|---|
| Thư viện mặt: tạo/sửa/xoá/liệt kê | `personlib/{add,update,delete,list}` |
| Người trong thư viện | `person/{add,import,update,delete,list}` |
| Thư viện đồng phục | `workclotheslib/{add,update,delete,list}` |
| Ảnh đồng phục | `workclothes/{add,batchadd,delete,list}` |

Ảnh đi bằng `image_base64`. `lib_id` là integer. Xoá nhận array (`lib_id: [..]`,
`person_id_list: [..]`). Chi tiết tham số: grep `_apidoc.txt` chương 2/3/7/8.

## 5. Tra cứu dữ liệu quá khứ

| Task | Endpoint | Ghi chú |
|---|---|---|
| Tìm cảnh báo hành vi | `search/behavior` | `channel_id` là **array**. `start_time`/`end_time` là unix giây (10 số). |
| Tìm ảnh mặt bắt được | `search/facecap` | Có filter `faceattr` (gender/age/glass/mask). |
| Hành vi + so khớp mặt | `search/behaviormatch` | |
| Kết quả so khớp mặt | `search/facematch` | |
| Đếm người qua vạch | `search/line/start` → `progress` → `result` → `stop` | Async, 4 bước, dùng `search_id`. Không phân trang. |
| Xuất file | `search/export`, `search/fuel/export` | Không có trong PDF. |

Phân trang: `{page, pagesize}` → `data.total` + `data.list`. Lặp khi `(page-1)*pagesize < total`.
Không có cursor.

**Lấy ảnh/clip**: kết quả trả `big_picture_url` dạng
`/api/v2/smart/picture?Type=1&Index=ubs_..&Size=..` — đây là **GET**, và bridge đã proxy sẵn tại
`/aibox/picture?<query>`. Clip: `/aibox/video?ChlId=..&StartTime=..&EndTime=..`.

## 6. Nhận cảnh báo real-time (quan trọng nhất)

| Bước | Endpoint |
|---|---|
| 1. Dựng server nhận TRƯỚC | (của mình — box không queue cho listener chết) |
| 2. Đọc config hiện tại | `docking/config/get` |
| 3. Merge rồi ghi | `docking/config/update` |
| 4. Xác nhận | `docking/config/get` |
| (EIA) hỏi version hỗ trợ | `docking/ability/get` |

- `docking/config/update` **ghi đè cả `platform[]` và `time_conf[]`**. Gửi partial = xoá platform
  khác + mất setting kênh khác. Read-modify-write.
- Transport chọn bằng scheme URL: `http://` / `https://` / `ws://`. Không có enum.
- Box POST về URL đó với `type` 1-7 (1 hành vi, 2 reset, 3 face snapshot, 4 face compare,
  5 behavior compare, **6 keep-alive**, 7 đổi channel). Ack lại bằng `{"code":200}`.
- Video/ảnh alarm đến **cùng path** nhưng `Content-Type: multipart/form-data` → dispatch theo
  Content-Type, không theo URL.
- Khung vật thể trong `behaviour.capture_info[]`, toạ độ thang 0~10000. Xem `API_CAUHINH_AI.md` §4.
- **Callback không có xác thực gì cả** — không token, không signature. Dùng `https://` và
  IP-allowlist ở server nhận.

Trong repo: `aibox.py` đã có `POST /alarm` (nhận + lưu `alarms/alarms.jsonl`) và `GET /events` (SSE).

## 7. Endpoint có trên box nhưng KHÔNG có trong PDF

PDF (54 endpoint) thiếu nhiều thứ web UI vẫn làm được. 83 endpoint đã trích từ bundle JS
(`_boxui/*.js`). Đáng chú ý:

| Nhóm | Endpoint |
|---|---|
| Thuật toán | `algo/capabilities`, `algo/list/current`, `smart/default/param`, `smart/hashinfo/get`, `smart/enable/list` |
| Chuyên biệt | `smart/plate/{get,update}` (biển số), `smart/faceguard/{get,update}`, `smart/bigmodel/config/*` (LLM) |
| Liên kết | `linkage/{get,update}`, `linkage/web/{get,update}` |
| Âm thanh | `sound/audio/*`, `sound/local/audition` |
| Lưu trữ | `storage/udisk/{info,format,format/progress}` |
| Xem trực tiếp | `mmi/stream/{start,stop}`, `mmi/vod/{start,stop}`, `stream/platform/rtsp/get` |
| Tìm bằng ảnh | `searchimage/{condition,query,progress}` |
| Model tự train | `wt/model/*`, `wt/isf/*` |
| Khác | `system/qrcode/get`, `custom/logo/*`, `channel/name/update` |

Cách dò body cho endpoint không tài liệu: gửi `{}` rồi thêm dần field đến khi `code 0`.
Quy trình đầy đủ ở `API_CAUHINH_AI.md` §1-2.

## 8. Mã lỗi hay gặp

| Code | Nghĩa | Xử lý |
|---|---|---|
| 0 | Succeed | |
| 2 | Invalid Arguments | Thiếu field. Ở time/linkage: thiếu `algo_model`. |
| 3 | Not Authorized | Digest sai/hết hạn → làm lại vòng challenge. |
| 4 | Not Supported | Box này không có tính năng đó. |
| 1000 | Sai user/password | |
| 1500 | Algo không cấu hình đồng thời được | Bỏ 1 trong 2 thuật toán xung đột. |
| 400314 | Channel không tồn tại | |
| 400323 | Channel offline | |
| 400366 | Chưa vẽ vùng ROI | Gọi `smart/update` với `point_x`/`point_y` trước. |
| 400382 | Channel chưa bật AI | Gọi `smart/task` `{status:1}` trước. |

Bảng đầy đủ: `python -c "import json;[print(e['mechanics']) for e in json.load(open('_extract.json',encoding='utf-8')) if 'Ch14' in e['section']]"`
