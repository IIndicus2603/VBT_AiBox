# Kế hoạch dùng Edge Smart Products OpenAPI v2.3.9 (UNV AIBOX / ECS / EIA)

Nguồn: `Edge Smart Products API Document-V2.3.9-20260320.pdf` (163 trang) + demo Java kèm theo
(`demo/src/main/java/com/uni/...`). Text đã bóc ra `_apidoc.txt` để grep, dữ liệu chi tiết từng
chương ở `_extract.json`.

Bối cảnh dự án hiện tại: `go2rtc.exe` + `ui/` chỉ xem RTSP trực tiếp từ camera. AIBOX là lớp
khác: nó **quản lý channel, chạy AI, và tự đẩy alarm về server của mình**. Hai thứ ghép được:
go2rtc lo hình ảnh live, AIBOX lo sự kiện.

---

## 1. Nền tảng: xác thực + envelope

**Digest MD5 (RFC 2617, qop=auth)**. Không có login/token, không cookie. Mọi call là `POST`
`Content-Type: application/json`, body JSON, UTF-8.

```
r1  = md5hex(username:realm:password)
r2  = md5hex(METHOD:path)            # path thôi, bỏ scheme/host/query
res = md5hex(r1:nonce:nc:cnonce:qop:r2)
```

Header gửi lên (chú ý dấu ngoặc kép **không đối xứng** — `qop` và `nc` không có ngoặc):

```
Authorization: Digest username="admin", realm="NVRDVR", nonce="1923473498",
  uri="/api/v2/algo/list", algorithm="MD5", qop=auth, response="<res>",
  nc=00000002, cnonce="0wQGXJQP"
```

Luồng:
1. Call lần đầu không có `Authorization` → HTTP 401, header `WWW-Authenticate: Digest
   qop="auth",algorithm="MD5",realm="NVRDVR",nonce="...",stale="FALSE"`, body `{"code":3,
   "msg":"Not Authorized","status_code":401}`.
2. Tính digest, gửi lại → OK.
3. **Cache `realm`/`nonce`/`qop` cho các request sau** (demo Java làm đúng vậy: một
   `LAPIHttpConnection` sống lâu, `nonceCount` là field instance khởi tạo = 1, tăng dần).
   Chỉ khi nào nhận 401 mới đi lại vòng challenge. Tạo connection mới mỗi request = 401 mỗi lần.

Điểm cần làm khác demo:
- Demo hardcode `cnonce = "0wQGXJQP"` vĩnh viễn → nên random 16 hex/lần.
- Regex parse challenge của demo là `(\w+)="(.*?)"` nên **bỏ sót param không có ngoặc kép**
  (`qop=auth` trần → qop = null → digest sai). Parse cả 2 dạng.
- MD5 hex chữ thường, tính trên bytes UTF-8. `nc` là `%08x`.

**Envelope response**, giống nhau toàn bộ tài liệu:
```json
{ "code": 0, "msg": "Succeed", "status_code": 0, "data": { ... } }
```
`code == 0` là thành công (ack mình trả về cho box thì dùng `code: 200` — đừng lẫn).

**Kênh WebSocket** (thay HTTP, cùng nội dung JSON): frame gửi
`{"uri":"/api/v2/search/behavior","method":"POST","data":{...},"msgid":"100005"}`, frame trả
`{"code":0,"msg":"Succeed","data":{...},"msgid":"100005"}`. `msgid` là của mình, box echo lại
để ghép request-response. AIBOX: WS cho cả config + reporting. EIA: WS chỉ cho reporting.

---

## 2. Bản đồ endpoint (54 endpoint, tất cả POST, prefix `/api/v2`)

| Nhóm | Endpoint |
|---|---|
| RSA | `/rsa/publickey` |
| Channel | `/channel/device/info` (dò ONVIF), `/channel/add`, `/channel/import`, `/channel/update`, `/channel/delete`, `/channel/list` |
| Lịch canh | `/control/time/update`, `/control/time/get` |
| AI config | `/algo/list`, `/smart/update`, `/smart/list`, `/smart/task`, `/smart/cycle`, `/smart/params/get`, `/smart/params/update`, `/extend/get`, `/extend/update` |
| Thư viện mặt | `/personlib/{add,update,delete,list}`, `/person/{add,import,update,delete,list}` |
| Đồng phục | `/workclotheslib/{add,update,delete,list}`, `/workclothes/{add,batchadd,delete,list}` |
| Thiết bị | `/device/get`, `/device/update` |
| Nâng cấp | `/upgrade`, `/upgrade/status` |
| Tra cứu | `/search/behavior`, `/search/facecap`, `/search/facematch`, `/search/behaviormatch`, `/search/line/{start,progress,result,stop}` |
| Đối tác | `/docking/config/get`, `/docking/config/update`, `/docking/ability/get` |
| Ảnh | `GET /api/v2/smart/picture?Type=&Index=&Size=` |

Chương 13 **không phải endpoint để gọi** — đó là spec những gì box POST tới server của mình.

---

## 3. Thứ tự bắt buộc (chỗ dễ sai nhất)

### Thêm camera vào AIBOX
```
POST /api/v2/rsa/publickey            → data.public_key
pwd = base64( RSA_encrypt(mật khẩu camera, public_key) )      # chỉ mã hoá pwd, max 512 ký tự
POST /api/v2/channel/device/info      { ip, port, username, pwd }   → video[] (id, rtsp, ...)
POST /api/v2/channel/add              → data.channel_id
```
- `type=1` (onvif) cần `ip/port/username/pwd`; `type=2` (rtsp) cần thẳng `rtsp` URL.
- `video_type`: 1 main, 2 custom (**bắt buộc kèm `video_id` lấy từ `/channel/device/info`**),
  3 third stream (chỉ LAPI).
- `transport_type`: 1 tcp, 2 udp, 3 lapi — **AIBOX bắt buộc có, VMS thì không**. Cùng một payload
  có thể pass ở box này, fail ở box khác.
- RTSP URL **không** mã hoá, `username` cũng đi cleartext. Chỉ `pwd` bị RSA.
- Tài liệu **không nói** padding (PKCS#1 v1.5 hay OAEP) hay key format của RSA → phải thử trên
  thiết bị thật. Ví dụ trong doc là placeholder ("123456789"). Ciphertext đi dưới dạng base64.
- `/channel/import` chỉ trả `data.fail_list` (theo tên), muốn biết `channel_id` phải gọi
  `/channel/list` sau đó.

### Cấu hình AI cho một channel
```
POST /api/v2/algo/list                → danh sách algo_model hợp lệ của box này
POST /api/v2/smart/task               { channel_id, status: 1 }   # bật AI cho channel trước
POST /api/v2/smart/list               → smart_list hiện tại
POST /api/v2/smart/update             { smart_list: [...] }        # GHI ĐÈ TOÀN BỘ
POST /api/v2/control/time/update      { channel_id, algo_model, control_time: {...} }
```
- `/algo/list` là **cách duy nhất** biết chuỗi `algo_model` box hỗ trợ. Đừng hardcode.
- `/smart/update` là ghi cả list, không phải patch — đọc rồi merge rồi ghi, thiếu entry nào là
  mất entry đó. Cùng nguyên tắc cho `/extend/*` và `/smart/params/*`.
- Lỗi tiền đề: `400314` channel không tồn tại, `400323` channel offline, `400382` channel chưa
  bật AI, `400366` chưa vẽ vùng.
- **Bất đối xứng key giữa get và update**: 6.1 ghi dùng `smart_list`, 6.4 đọc trả array chứa
  `smart_list` nhưng 6.5 ghi lại dùng key `list`. Không suy diễn get/update đối xứng.

### Nhận alarm (chương 12 + 13) — quan trọng nhất
```
1. Dựng HTTP server của mình TRƯỚC (box không queue push cho listener chết)
2. POST /api/v2/docking/ability/get    (EIA thôi; AIBOX dùng luôn version_code "V2.0")
3. POST /api/v2/docking/config/get     -> đọc platform[] + time_conf[] hiện tại
4. merge thay đổi, POST /api/v2/docking/config/update    # GHI ĐÈ CẢ 2 ARRAY
5. POST /api/v2/docking/config/get     -> xác nhận
```
- **`/docking/config/update` là full replace** cả `platform[]` và `time_conf[]`. Gửi partial là
  xoá platform khác và mất setting interval của channel khác. Read-modify-write.
- Read side trả `channel_name`, write side **không nhận** field đó, phải strip trước khi ghi lại.
- Transport chọn bằng **scheme của URL**: `http://`, `https://`, `ws://`. Không có enum riêng.
- Cờ: `enabled`, `picture_enable`, `video_enable`, `pdf_enable`, `http_alive` +
  `alive_interval` (30-600) + `alive_url`, `channel_enable`. Max 20 platform. `url` max 256.
- CẢNH BÁO: **callback không có xác thực gì cả** — không token, không secret, không signature,
  không client cert. Ai gọi được `/docking/config/update` là đổi được đích push của box sang host
  bất kỳ. Hai việc phải làm: dùng `https://` cho `url`, và IP-allowlist trên server nhận.
