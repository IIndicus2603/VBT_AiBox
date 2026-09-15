import './video-stream.js';
// wiring/toast/modal ở ui.js — vòng import an toàn vì chỉ gọi function declaration
import {onStateChange, loadLog} from './ui.js';

// UI được serve từ HAI chỗ: go2rtc (:1984 static_dir) và aibox.py (:8090).
// Mỗi bên chỉ có MỘT NỬA API -> nửa còn lại phải gọi tuyệt đối, nếu không
// api/streams ở :8090 sẽ 404 và cả lưới camera chết. go2rtc mở origin:"*",
// aibox mở CORS cho localhost -> gọi chéo được cả hai chiều.
// Đổi cổng thì sửa đúng 2 số dưới đây.
// Goc cua BE (vd 'http://192.168.21.34'). App trong bo cai phuc vu giao dien tu
// 127.0.0.1:<port> cua CHINH MAY KHACH -> location.hostname tro nham cho, nen
// preload bom san globalThis.AIBOX_ORIGIN. Mo qua trinh duyet thi khong co bien
// do -> suy ra tu chinh URL trang, y nhu truoc.
// Cat cong neu co. AIBOX_ORIGIN den tu server.txt (nguoi dung hay go kem ':8090'),
// ma ben duoi luon TU gan cong -> de nguyen se thanh '...:8090:8090' va moi loi goi
// API hong (URL rac). Cat o day thi ca hai nguon deu cho ket qua nhu nhau.
const noPort = s => String(s).replace(/\/+$/, '').replace(/:\d+$/, '');
export const ORIGIN = noPort(globalThis.AIBOX_ORIGIN
  || ((location.protocol || 'http:') + '//' + (location.hostname || '127.0.0.1')));
const at = p => location.port === String(p) ? '' : ORIGIN + ':' + p + '/';
export const G = at(1984);      // go2rtc: streams, ws, log, config
// base cua aibox.py (:8090) o ai.js -> BASE, khong lap lai o day
export const API = G + 'api/streams';
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const pad = n => String(n).padStart(2, '0');
export const hms = d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad).join(':');

// go2rtc trả URL kèm mật khẩu trần -> luôn che trước khi vào DOM
export const mask = u => String(u).replace(/^([a-z0-9+.-]+:\/\/)([^:@/]+):[^@/]*@/i, '$1$2:••••@');

// Một '%' không theo sau 2 ký tự hex là escape sai -> go2rtc parse URL fail
// ("invalid URL escape"). Mật khẩu camera hay có '%' trần. Chỉ sửa trong user:pass.
export const fixPct = u => u.replace(/^([a-z]+:\/\/)([^@/]*)@/i,
  (_, scheme, ui) => scheme + ui.replace(/%(?![0-9A-Fa-f]{2})/g, '%25') + '@');

const CODEC = {h264: 'H.264', hevc: 'H.265', h265: 'H.265', aac: 'AAC', pcma: 'PCMA', pcmu: 'PCMU'};
export const nice = c => CODEC[c] || (c || '').toUpperCase();

export const S = {
  api: {},           // name -> object từ /api/streams
  bps: {},           // name -> Mbps (tính từ delta bytes)
  last: {},          // name -> {bytes, t}
  tiles: new Map(),  // name -> {box, player, state, err, fps, frames, ft}
  order: [],         // thứ tự tên luồng
  filter: 'all',
  cols: 3,
  page: 0,
  view: 'live',
  focus: null,       // tên luồng đang mở ở detail
  seen: {},          // name -> state cuối, để chỉ toast khi ĐỔI trạng thái
};

export const FILTERS = [
  {k: 'all',  l: 'Tất cả',    dot: 'var(--cy)'},
  {k: 'live', l: 'Đang phát', dot: 'var(--ok)'},
  {k: 'down', l: 'Có lỗi',    dot: 'var(--err)'},
];

/* ================= API ================= */

export const jget = async (u, ms = 8000) => {
  const r = await fetch(u, {signal: AbortSignal.timeout(ms)});
  if (!r.ok) throw new Error((await r.text()) || 'HTTP ' + r.status);
  return r.json();
};

// producers null khi chưa ai xem luồng -> mọi thứ phải guard, không được coi là 0
export const videoRx = o => (o?.producers?.[0]?.receivers || [])
  .filter(r => r.codec?.codec_type === 'video');

export function pollStreams() {
  return jget(API, 6000).then(j => {
    const t = performance.now();
    for (const [name, o] of Object.entries(j)) {
      const bytes = videoRx(o).reduce((s, r) => s + (r.bytes || 0), 0);
      const p = S.last[name];
      // cần 2 mẫu; bytes tụt = producer vừa restart -> bỏ mẫu, không ra số âm
      if (p && bytes >= p.bytes && t > p.t) S.bps[name] = (bytes - p.bytes) * 8 / (t - p.t) / 1000;
      S.last[name] = {bytes, t};
    }
    for (const name of Object.keys(S.api)) if (!(name in j)) delete S.bps[name];
    S.api = j;
    return j;
  });
}

/* ================= trạng thái luồng ================= */

export const tileState = name => S.tiles.get(name)?.state || 'wait';
export const isDown = name => tileState(name) === 'down';

export function statusOf(name) {
  const st = tileState(name);
  if (st === 'live') return {cls: '', txt: 'LIVE'};
  if (st === 'down') return {cls: 'off', txt: 'OFFLINE'};
  if (st === 'pause') return {cls: 'wait', txt: 'TẠM DỪNG'};
  return {cls: 'wait', txt: 'ĐANG KẾT NỐI'};
}

export function codecLine(name) {
  const rx = videoRx(S.api[name])[0];
  if (!rx) return null;
  const c = rx.codec;
  const lvl = c.profile && c.level ? ` ${c.profile} ${(c.level / 10).toFixed(1)}` : '';
  return nice(c.codec_name) + lvl;
}

export function metaOf(name) {
  const t = S.tiles.get(name);
  const v = t?.player?.video;
  const res = v?.videoHeight ? v.videoHeight + 'p' : null;
  const fps = t?.fps ? t.fps + 'fps' : null;
  return [res, fps].filter(Boolean).join(' · ') || '—';
}

export function noteOf(name) {
  const t = S.tiles.get(name);
  if (t?.state === 'down') return t.err ? String(t.err).slice(0, 42) : 'Mất kết nối';
  if (t?.state === 'pause') return 'ngoài vùng nhìn';
  const b = S.bps[name], c = videoRx(S.api[name])[0]?.codec?.codec_name;
  return [b ? b.toFixed(1) + ' Mbps' : null, c ? nice(c) : null].filter(Boolean).join(' · ');
}

/* ================= grid ================= */

export function visibleNames() {
  const names = S.order.filter(n =>
    S.filter === 'live' ? tileState(n) === 'live' :
    S.filter === 'down' ? isDown(n) : true);
  const size = S.cols * S.cols;
  const pages = Math.max(1, Math.ceil(names.length / size));
  S.page = Math.min(S.page, pages - 1);
  return {names, pages, size, shown: names.slice(S.page * size, S.page * size + size)};
}

export function makeTile(name) {
  const box = $('#t-tile').content.firstElementChild.cloneNode(true);
  const p = document.createElement('video-stream');
  p.mode = 'webrtc,mse';         // phải set TRƯỚC src
  p.media = 'video';             // lưới không cần audio
  p.visibilityThreshold = 0.01;  // cuộn ra ngoài thì dừng decode
  box.prepend(p);

  // st/ar giữ sẵn 2 badge. paintTile KHÔNG được querySelector('.badge') nữa: badge đếm
  // người đứng TRƯỚC nên first-match trúng nó và ghi đè thành chữ LIVE.
  const t = {box, player: p, state: 'wait', err: null, fps: 0, frames: 0, ft: 0,
             st: box.querySelector('.badge:not(.t-area)'), ar: box.querySelector('.t-area')};
  S.tiles.set(name, t);

  p.addEventListener('state', e => {
    const d = e.detail;
    // 'idle' = bị tháo có chủ ý (cuộn ra ngoài / đổi tab) -> KHÔNG phải lỗi
    // 'retry' -> 'wait' (ĐANG KẾT NỐI), KHÔNG phải 'down': player chỉ báo 'error'
    // sau khi đã thử lại maxRetry lần liên tiếp (ui/video-stream.js).
    t.state = {live: 'live', connecting: 'wait', idle: 'pause', retry: 'wait', error: 'down'}[d.state]
      || 'wait';
    if (d.error) t.err = d.error;
    if (t.state === 'live') t.err = null;
    onStateChange(name, t);
    paintTile(name);
  });

  box.onclick = () => openDetail(name);
  // setter chỉ đổi http->ws, không resolve đường dẫn -> phải là URL tuyệt đối
  p.src = new URL(G + 'api/ws?src=' + encodeURIComponent(name), location.href);
  return t;
}

export function paintTile(name) {
  const t = S.tiles.get(name);
  if (!t) return;
  const st = statusOf(name);
  const b = t.st;
  b.className = 'badge ' + st.cls;
  const bt = b.querySelector('.t');
  (bt || b).textContent = st.txt;
  t.box.querySelector('.t-name').textContent = name;
  t.box.querySelector('.t-code').textContent = codecLine(name) || 'chưa có codec';
  t.box.querySelector('.t-meta').textContent = metaOf(name);
  const note = t.box.querySelector('.t-note');
  note.textContent = noteOf(name);
  note.style.color = t.state === 'down' ? 'var(--err2)' : 'var(--dim)';
  t.box.classList.toggle('alert', t.state === 'down');
}

export function drawGrid() {
  const {names, pages, size, shown} = visibleNames();
  const grid = $('#grid');
  grid.style.gridTemplateColumns = `repeat(${S.cols},minmax(0,1fr))`;
  // Hàng = 1fr: lưới lấp đầy chiều cao viewport nên mọi camera hiện trọn trên
  // màn live, không cuộn. Tile (style.css #grid > .tile) tự giãn theo hàng.
  grid.style.gridTemplateRows = `repeat(${S.cols},minmax(0,1fr))`;

  // tile được TÁI SỬ DỤNG: tạo lại element sẽ giết stream đang chạy
  const boxes = shown.map(n => (S.tiles.get(n) || makeTile(n)).box);
  if (!boxes.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = '<span class="plus">+</span><span class="t">Không có luồng nào khớp</span>';
    grid.replaceChildren(e);
  } else {
    grid.replaceChildren(...boxes);
  }
  shown.forEach(paintTile);

  // luồng bị lọc/ sang trang khác: gỡ khỏi DOM -> player tự ngắt sau 5s
  for (const [n, t] of S.tiles) if (!S.order.includes(n)) { t.box.remove(); S.tiles.delete(n); }

  const pg = $('#pager');
  pg.hidden = pages < 2;
  if (pages > 1) {
    $('#pgNums').replaceChildren(...Array.from({length: pages}, (_, i) => {
      const b = document.createElement('button');
      b.className = 'pg' + (i === S.page ? ' on' : '');
      b.textContent = i + 1;
      b.onclick = () => { S.page = i; drawGrid(); };
      return b;
    }));
    $('#pgPrev').classList.toggle('dis', S.page === 0);
    $('#pgNext').classList.toggle('dis', S.page >= pages - 1);
  }
}

/* ================= detail ================= */

export let dPlayer = null;

export function openDetail(name) {
  S.focus = name;
  go('detail');
  $('#dName').textContent = name;
  $('#dSrc').textContent = mask(S.api[name]?.producers?.[0]?.url || '—');

  const stage = $('#stage');
  stage.querySelectorAll('video-stream').forEach(n => n.remove());
  dPlayer = document.createElement('video-stream');
  dPlayer.mode = 'webrtc,mse';
  dPlayer.media = 'video,audio';   // detail mới cần tiếng
  dPlayer.visibilityCheck = false;
  stage.prepend(dPlayer);
  dPlayer.addEventListener('state', e => {
    const s = e.detail.state;
    // Class chu khong phai style.opacity: inline style chong len ca luc dang
    // XEM LAI clip, lam nut LIVE mo tit du no dang la nut bam duoc.
    const lv = $('#dLive');
    if (!lv.classList.contains('back')) lv.classList.toggle('wait', s !== 'live');
    if (e.detail.error) dPlayer.lastErr = e.detail.error;
  });
  dPlayer.src = new URL(G + 'api/ws?src=' + encodeURIComponent(name), location.href);
  dPlayer.t0 = Date.now();
  $('#dMute').textContent = '🔇';
  paintDetail();
}

/** Thao player live nhung GIU S.focus — dung khi chieu clip xem lai tren cung
 *  khung stage. closeDetail() xoa ca S.focus nen khong dung duoc cho viec nay. */
export function detachDetailPlayer() {
  if (dPlayer) { dPlayer.remove(); dPlayer = null; }
}

export function closeDetail() {
  if (dPlayer) { dPlayer.remove(); dPlayer = null; }
  S.focus = null;
}

export const row = (k, v, cls) =>
  `<div class="row"><span class="rk">${k}</span><span class="rv ${cls || ''}">${v}</span></div>`;

export function paintDetail() {
  const name = S.focus;
  if (!name || !dPlayer) return;
  const o = S.api[name] || {};
  const p = o.producers?.[0];
  const rx = videoRx(o)[0];
  const audio = (p?.medias || []).some(m => m.startsWith('audio'));
  const v = dPlayer.video;
  const dash = '<span class="rv none">—</span>';

  $('#dRows').innerHTML =
    row('URL', p ? mask(p.url) : dash, 'dim') +
    row('Nguồn', p ? `${p.remote_addr || '—'} · ${p.protocol || '—'}` : dash) +
    row('Codec', codecLine(name) || dash) +
    row('Bitrate', S.bps[name] ? S.bps[name].toFixed(1) + ' Mbps' : dash) +
    row('Âm thanh', audio ? 'có ở nguồn' : 'không có', audio ? '' : 'none') +
    row('Người xem', String(o.consumers?.length ?? 0));

  const q = v && typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null;
  const up = dPlayer.t0 ? Math.floor((Date.now() - dPlayer.t0) / 1000) : 0;
  $('#dRows2').innerHTML =
    row('Chế độ', dPlayer.playMode || 'đang thoả thuận…', dPlayer.playMode ? 'ok' : 'warn') +
    row('Phân giải', v?.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : dash) +
    row('FPS', dPlayer.fps ? String(dPlayer.fps) : dash) +
    row('Khung rơi', q ? String(q.droppedVideoFrames) : dash) +
    row('RTT', dPlayer.rtt != null ? dPlayer.rtt + ' ms' : dash) +
    row('Kết nối', `${Math.floor(up / 60)}m ${pad(up % 60)}s`);

  $('#dQual').textContent = [
    v?.videoHeight ? v.videoHeight + 'p' : null,
    dPlayer.fps ? dPlayer.fps + 'fps' : null,
    S.bps[name] ? S.bps[name].toFixed(1) + ' Mbps' : null,
    codecLine(name),
  ].filter(Boolean).join(' · ') || 'đang chờ hình…';
  $('#dUp').textContent = dPlayer.playMode ? 'Chế độ ' + dPlayer.playMode : '—';
}

/* ================= đo fps / rtt phía client ================= */

export function sampleFps(pl) {
  const v = pl?.video;
  if (!v || typeof v.getVideoPlaybackQuality !== 'function') return;
  const q = v.getVideoPlaybackQuality(), t = performance.now();
  if (pl._f && t > pl._t) pl.fps = Math.round((q.totalVideoFrames - pl._f) * 1000 / (t - pl._t));
  pl._f = q.totalVideoFrames; pl._t = t;
}

export async function sampleRtt(pl) {
  // getStats chỉ có ở WebRTC; MSE thì pc = null -> để null, KHÔNG hiện 0
  if (!pl?.pc || pl.pcState !== WebSocket.OPEN) { if (pl) pl.rtt = null; return; }
  try {
    const s = await pl.pc.getStats();
    let rtt = null;
    s.forEach(r => {
      if (r.type === 'candidate-pair' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
    });
    pl.rtt = rtt == null ? null : Math.round(rtt * 1000);
  } catch { pl.rtt = null; }
}

/* ================= điều hướng ================= */

// ui.js dat paintHistory vao day. Khong import truc tiep duoc: app.js <-> ui.js
// la vong import, goi ham cua ui.js o top-level app.js se undefined.
export const hooks = {onView: null};

export function go(view) {
  S.view = view;
  for (const v of ['live', 'detail', 'log', 'lib', 'cam', 'ai', 'cfg']) $('#v-' + v).hidden = v !== view;
  if (view !== 'detail') closeDetail();
  $$('nav button').forEach(b => b.classList.toggle('on',
    b.dataset.go === view || (view === 'detail' && b.dataset.go === 'live')
    || (view === 'ai' && b.dataset.go === 'cfg')));
  if (view === 'log') loadLog();
  hooks.onView?.(view);
}
