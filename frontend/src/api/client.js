/**
 * Shared API helpers — port of app.js:17-62 + ai.js:24-44 (noPort/ORIGIN/BASE/G).
 *
 * UI được serve từ frontend dev server (:5173) nhưng backend API do aibox.py giữ
 * (:8090) và go2rtc giữ (:1984). Trong Vite, /api & /aibox được proxy tới 8090 và
 * /api/ws tới 1984 (xem vite.config.js). Vẫn giữ các hằng origin phòng khi chạy
 * bản build tĩnh serve từ chính backend (y như UI vanilla cũ).
 *
 * AIBOX_ORIGIN có thể đến từ preload (server.txt) và hay kèm ':8090' — cắt cảng.
 */

const noPort = s => String(s).replace(/\/+$/, '').replace(/:\d+$/, '');
const guessOrigin = () => {
  if (typeof location !== 'undefined') {
    // return (location.protocol || 'http:') + '//' + (location.hostname || '127.0.0.1');
    const host = location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return location.protocol + '//' + host;
    }
  }
  return 'http://localhost';
  // return 'http://192.168.21.56';
};

export const ORIGIN = noPort(globalThis.AIBOX_ORIGIN || guessOrigin());

// go2rtc origin (:1984) — stream WS.
const at = p => (typeof location !== 'undefined' && location.port === String(p)) ? '' : ORIGIN + ':' + p + '/';
export const G = at(1984);

// base của aibox.py (:8090).
export const BASE = (typeof location !== 'undefined' && location.port === '8090') ? '' : ORIGIN + ':8090/';

// API streams của go2rtc (chỉ dùng khi chưa qua proxy).
export const API = G + 'api/streams';

export const pad = n => String(n).padStart(2, '0');
export const hms = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad).join(':');

// go2rtc trả URL kèm mật khẩu trần -> luôn che trước khi vào DOM.
export const mask = u => String(u).replace(/^([a-z0-9+.-]+:\/\/)([^:@/]+):[^@/]*@/i, '$1$2:••••@');

// Một '%' không theo sau 2 ký tự hex là escape sai -> go2rtc parse URL fail.
// Mật khẩu camera hay có '%' trần. Chỉ sửa trong user:pass.
export const fixPct = u => u.replace(/^([a-z]+:\/\/)([^@/]*)@/i,
  (_, scheme, ui) => scheme + ui.replace(/%(?![0-9A-Fa-f]{2})/g, '%25') + '@');

const CODEC = {h264: 'H.264', hevc: 'H.265', h265: 'H.265', aac: 'AAC', pcma: 'PCMA', pcmu: 'PCMU'};
export const nice = c => CODEC[c] || (c || '').toUpperCase();

/** URL tuyệt đối tới route/file của backend. PHẢI tuyệt đối: BASE = '' khi UI chạy ở
 *  :8090 nên đường tương đối sẽ lệch ngay khi trang không ở '/'. */
export const absUrl = rel => {
  const s = String(rel);
  return new URL(BASE + (s.startsWith('/') ? s.slice(1) : s),
    typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
};

/** Ảnh phát hiện của 1 alarm (port imgOf ai.js:1447). Hai dạng phải xử lý khác nhau:
 *  'x.jpg' = ảnh base64 backend đã lưu -> /alarms/x.jpg (đọc file hoặc GridFS), còn
 *  '/aibox/picture?...' = ảnh vẫn nằm trên box, kéo về qua proxy digest. */
export const imgOf = a => {
  const p = (a?.images || [])[0];
  if (!p) return null;
  return absUrl(String(p).startsWith('/') ? p : 'alarms/' + p);
};

/** Khóa ổn định + DUY NHẤT cho 1 sự kiện để dùng làm React key / data-id / dedup.
 *  event_id của box KHÔNG phải là duy nhất: cùng 1 lần phát hiện, box đẩy 2 biến thể
 *  là type 1 (behavior) và type 5 (behavior+match) nhưng dùng chung event_id — nên
 *  ghép thêm type để không trùng key, không dedup nhầm, và highlight đúng 1 dòng. */
export const evKey = a => {
  if (!a || a.event_id == null) return 'ts' + (a.ts || '0');
  return a.event_id + ':' + (a.type ?? '');
};

/** Gộp các sự kiện trùng event_id, chỉ giữ bản "đầy đủ nhất". Box gửi cùng 1 lần
 *  phát hiện 2 biến thể: type 1 (behavior) rồi type 5 (behavior+match, có nhận diện
 *  người). Nếu đã có type 5 thì bỏ type 1. Giữ nguyên thứ tự, bổ sung bản không có
 *  event_id (lọc theo ts riêng ở chỗ dùng). */
export const dedupBest = list => {
  const best = new Map();
  const noId = [];
  for (const a of list || []) {
    if (!a) continue;
    if (a.event_id == null) { noId.push(a); continue; }
    const cur = best.get(a.event_id);
    if (!cur || (a.type ?? 0) > (cur.type ?? 0)) best.set(a.event_id, a);
  }
  return [...noId, ...best.values()];
};

/** Clip xem lại của 1 alarm (port videoOf ai.js:1461). Box KHÔNG giữ sẵn file: video_url
 *  là lệnh cắt theo khoảng thời gian, mỗi lần mở là 1 request GET vào box (~1.4MB). */
export const videoOf = a => (a?.video_url ? absUrl(a.video_url) : null);

/** GET json, timeout mặc định 8s (mẫu app.js jget). */
export const jget = async (u, ms = 8000) => {
  const r = await fetch(u, {signal: AbortSignal.timeout(ms)});
  if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
  return r.json();
};

/** POST json tới aibox.py, trả j.data — port post() của ai.js:31-39.
 *  aibox trả {code, msg?, data?}; code !== 0 thì throw. */
export const post = async (path, body) => {
  const r = await fetch(BASE + 'aibox/' + path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${path}: ${j.msg || 'code ' + j.code}`);
  return j.data || {};
};