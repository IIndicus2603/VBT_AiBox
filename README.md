# VBT AiBox

Cầu nối (bridge) giữa box camera UNV và UI web: proxy digest-auth, nhận cảnh báo
(alarm), đồng bộ stream sang go2rtc, gửi ảnh/clip + lệnh qua Telegram.

- `aibox.py` — backend, **chỉ dùng stdlib**, serve UI ở `:8090`
- `ui/` — web UI (**source of truth**), aibox.py serve trực tiếp
- `electron-app/` — chỉ dùng để **đóng gói** thành app desktop
- `go2rtc.exe` + `go2rtc.yaml` — server stream, chạy ở `:1984`

---

## 1. Yêu cầu

| Thành phần | Bản | Ghi chú |
|---|---|---|
| Python | 3.8+ (đã test 3.13) | `aibox.py` không cần thư viện ngoài |
| PyInstaller | 6.x | **chỉ cần khi build**, `pip install -r requirements.txt` |
| Node.js | 18+ | **chỉ cần khi build** app Electron |
| Windows | — | `dev.ps1` và lệnh build dùng cú pháp Windows |

```powershell
pip install -r requirements.txt
```

---

## 2. Chạy dev server

### Cách A — chỉ backend + trình duyệt (khuyên dùng khi sửa UI)

```powershell
.\dev.ps1
```

Script sẽ:
1. Kill tiến trình cũ trên `:8090` và `:1984`
2. Mở cửa sổ PowerShell riêng chạy `py aibox.py` (xem log ở đó)
3. Đợi port `:8090` sẵn sàng rồi mở `http://localhost:8090`

Không cần Node, không cần Electron. Sửa `ui/` xong chỉ cần F5.

Chạy tay nếu muốn:

```powershell
py aibox.py
```

### Cách B — Electron dev (có DevTools + HMR)

```powershell
cd electron-app
npm install
npm run dev
```

Electron tự spawn `py aibox.py`, đợi `:8090` rồi mở cửa sổ kiosk kèm DevTools.

> **Khác biệt quan trọng:** ở chế độ này `AIBOX_DATA` trỏ vào
> `%APPDATA%\unv-smartbox-desktop\`, nên `aibox.conf.json` / `alarms/` nằm ở đó
> **chứ không** nằm trong thư mục dự án. Xem mục 5.

---

## 3. Build

### Build backend (PyInstaller → `dist/aibox/`)

```powershell
cd electron-app
npm run build:backend
```

Lệnh này `cd ..` rồi chạy PyInstaller với `--add-binary go2rtc.exe` và
`--add-data ui;ui`, đầu ra ở `dist/aibox/`.

### Build trọn bộ ra file cài đặt

```powershell
cd electron-app
npm run build:exe
```

Gồm 3 bước: `build:backend` → `tsc && vite build` → `electron-builder --win`.

Đầu ra:

```
electron-app/out4/<version>/Vibotics AI Smart Box-<version>-Setup.exe
```

`electron-app/out4/<version>/win-unpacked/` là bản chạy trực tiếp, không cần cài.

### Các script khác

| Lệnh | Việc |
|---|---|
| `npm run build` | `tsc && vite build && electron-builder` (mọi nền tảng) |
| `npm run build:win` | như trên, chỉ Windows |

---

## 4. Test

```powershell
py aibox.py --selftest
```

Chạy các `assert` kiểm tra logic nội bộ (không cần box, không cần mạng).

```powershell
py test_add_channel.py
py test_edit_channel.py
py test_tg_filter.py
```

---

## 5. Cấu hình

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BRIDGE_PORT` | `8090` | Port UI + API của aibox |
| `GO2RTC` | `127.0.0.1:1984` | Địa chỉ API go2rtc |
| `AIBOX_DATA` | thư mục chứa `aibox.py` | Nơi ghi config / `alarms/` / log |
| `AIBOX_HOST` | *(rỗng)* | IP box UNV |
| `AIBOX_PORT` | `80` | Port box |
| `AIBOX_USER` | `admin` | User box |
| `AIBOX_PASS` | *(rỗng)* | Mật khẩu box |
| `TG_BOT_TOKEN` | *(rỗng)* | Token bot Telegram |
| `TG_CHAT_IDS` | *(rỗng)* | Danh sách chat_id, cách nhau bởi `,` |

Env chỉ là giá trị **mặc định lần đầu**. Sau đó sửa trong tab **Cấu hình** của UI —
giá trị được ghi vào `aibox.conf.json` và ưu tiên hơn env.

### File cấu hình

| File | Vị trí | Vai trò |
|---|---|---|
| `aibox.conf.json` | `AIBOX_DATA` | Host/pass box, Telegram token + nhóm |
| `go2rtc.yaml` | cạnh `go2rtc.exe` | Khai báo stream camera |
| `tg_groups.json` | `AIBOX_DATA` | Tự sinh — nhớ các nhóm bot từng thấy |
| `alarms/alarms.jsonl` | `AIBOX_DATA` | Tự sinh — lịch sử cảnh báo |
| `go2rtc.log` | `AIBOX_DATA` | Log của go2rtc |

`AIBOX_DATA` tuỳ chế độ chạy:

| Chế độ | `AIBOX_DATA` |
|---|---|
| `py aibox.py` / `dev.ps1` | thư mục dự án — dùng `aibox.conf.json` trong repo |
| Electron: cả `npm run dev` **lẫn** app đã cài | `%APPDATA%\unv-smartbox-desktop\` |

**Sửa config ở chế độ này không thấy ở chế độ kia** — kiểm tra đúng thư mục.

Lưu ý: `aibox.conf.json` trong repo **không được đóng gói** vào app (`build:backend`
chỉ add `go2rtc.exe`, `go2rtc.yaml`, `ui`). App Electron luôn đọc config ở
`%APPDATA%\unv-smartbox-desktop\`, nên lần đầu chạy sẽ trống. Điền qua tab
**Cấu hình**, hoặc copy sẵn trước khi chạy:

```powershell
copy aibox.conf.json "$env:APPDATA\unv-smartbox-desktop\"
```

### go2rtc — quy tắc đặt tên stream

Tên stream **bắt buộc** là `ch<channel_id>`, khớp với channel trên box.

`aibox.py` coi box là source of truth: mọi stream trong `go2rtc.yaml` **không có
channel tương ứng trên box sẽ bị xoá tự động**. Đặt tên kiểu `cam1`,
`camera_tang1` → bị xoá và không rõ lý do.

### Bảo mật

`aibox.conf.json` và `go2rtc.yaml` trong repo chứa **credential thật của một
deployment cụ thể**. Đổi hết trước khi dùng cho hệ thống của bạn.

`aibox.py` bind `0.0.0.0` nhưng **chỉ `/alarm` mở ra LAN**; UI, `/aibox/*`,
`/api/*` chỉ nhận request từ localhost.

---

## 6. Port

| Port | Dịch vụ |
|---|---|
| `8090` | aibox — UI + API + nhận alarm |
| `1984` | go2rtc — API stream (chỉ localhost) |

Điền URL này vào `/docking/config/update` trên box để nhận cảnh báo:

```
http://<ip-máy-chạy-aibox>:8090/alarm
```

aibox in ra URL chính xác lúc khởi động.

---

## 7. Lỗi thường gặp

**UI hiện nhưng mọi ô video đen**
Thiếu `go2rtc.exe` hoặc `go2rtc.yaml`. aibox in `! khong thay ...go2rtc.exe` rồi
bỏ cuộc sau 3 lần thử. Lưu ý: nếu chỉ thiếu `go2rtc.yaml`, go2rtc vẫn bind `:1984`
nên watchdog tưởng nó sống — không có log báo lỗi, chỉ là không có stream nào.

**`npm run build:exe` dừng ở bước backend**
`Unable to find "go2rtc.exe"` → thiếu file, hoặc chưa `pip install -r requirements.txt`.

**Không dán được lệnh PyInstaller vào PowerShell**
Lệnh trong `package.json` dùng `--add-binary go2rtc.exe;.` — dấu `;` là dấu ngăn
câu lệnh trong PowerShell. Chạy qua `npm run`, đừng copy tay vào PowerShell.

**App Electron mở nhưng cấu hình trống / không thấy camera**
App đọc config ở `%APPDATA%\unv-smartbox-desktop\`, không phải thư mục dự án.
`aibox.conf.json` trong repo chỉ có tác dụng với `dev.ps1` / `py aibox.py` (mục 5).

**Không thoát được cửa sổ Electron**
`kiosk: true` — F11/Esc/Alt+F4 đều không thoát. Dùng Task Manager. Muốn thoát dễ
hơn thì đổi `kiosk` thành `fullscreen` trong `electron-app/electron/main.js`.

**`EADDRINUSE` ở `:8090` hoặc `:1984`**
Tiến trình cũ chưa chết. `dev.ps1` tự dọn; chạy tay thì tự kill trước.

**Cảnh báo `LF will be replaced by CRLF`**
Bình thường trên Windows, không phải lỗi.
