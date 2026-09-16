// Entry point. app.js = state + render luoi; file nay = wiring + toast + cac view.
// Vong import app.js <-> ui.js an toan vi ui.js chi export function declaration
// (duoc hoist) va app.js khong chay gi o top-level.
import {
  $, $$, S, G, API, FILTERS, hms, pad, fixPct, nice, mask, row,
  tileState, isDown, pollStreams, drawGrid, paintTile, paintDetail,
  openDetail, closeDetail, detachDetailPlayer, go, hooks, sampleFps, sampleRtt, dPlayer,
  statusOf, codecLine,
} from './app.js';
import {
  BASE, algoName, algoGroups, alarms, alarmsOf, camOf, isDetect, imgOf,
  camKey, algoKey, logMatch,
  activeAlarm, clearAlarm, startAlarms, setNote, setGo, chIdOf, mergeRtsp,
  algoAll, cameraList, hashrate, openAI, initAI, loadAlarmHistory, seedAreaCount, videoOf, exitDraw, algoSave,
  areaCount, areaOn, loadAreaOn, confirmBox,
} from './ai.js';

/* ================= toast ================= */

// Mau vien/chu theo loai canh bao, dung bang mau voi cham moc o timeline.
const SEV_COLOR = {err: '#ff4d4f', warn: '#e8a020', ok: '#3ddc84'};

/** Toast 5 khoi nhu design: dau (cham + mux do + gio + X), anh 21/9, tieu de,
 *  phu de, hai nut. Cac toast cu xep CHONG sau toast moi nhat (khong thanh cot). */
function toast({sev, title, sub, name, kind, img, onSkip, color, ev}) {
  const col = color || SEV_COLOR[kind] || SEV_COLOR.warn;
  const box = document.createElement('div');
  box.className = 'toast ' + (kind || 'warn');
  box.setAttribute('data-glass', '');
  box.setAttribute('data-edge-alert', '');
  // Tên camera của popup này — để onCleared() đóng đúng popup khi cảnh báo bị
  // bỏ qua từ nơi khác (thẻ nhật ký, badge trên tile, nút trong trang chi tiết).
  box.dataset.cam = name || '';
  // 1:1 theo design Live Apple: 4 vet sang chay vien + lop bong tren + anh 16/9
  // co pill canh bao o goc phai, roi tieu de/phu + gio, cuoi cung 2 nut vang/kinh.
  box.innerHTML =
    '<span data-edge="top"></span><span data-edge="right"></span>' +
    '<span data-edge="bottom"></span><span data-edge="left"></span>' +
    '<div class="t-gloss"></div>' +
    '<div class="t-shot"><div class="t-scrim"></div>' +
      '<span class="t-badge"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.1" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.1 12.6A2 2 0 0 1 19.1 20H4.9a2 2 0 0 1-1.7-3.2z"/>' +
        '<path d="M12 9.4v4.2"/><path d="M12 16.6h.01"/></svg><b></b></span></div>' +
    '<div class="t-body"><div class="t-row1"><div class="t-tt">' +
        '<div class="t-ttl"></div><div class="t-sub"></div></div>' +
      '<span class="t-time"></span></div>' +
      '<div class="t-acts"><button class="go" data-goldbtn>Xem camera</button></div></div>';
  const badge = box.querySelector('.t-badge');
  badge.style.background = 'linear-gradient(168deg,color-mix(in srgb, ' + col +
    ' 30%, transparent),color-mix(in srgb, ' + col + ' 16%, transparent))';
  badge.style.border = '1px solid color-mix(in srgb, ' + col + ' 50%, transparent)';
  badge.querySelector('svg').style.stroke = col;
  const sevEl = badge.querySelector('b');
  sevEl.textContent = sev;
  sevEl.style.color = col;
  const now = new Date();   // design hien "dd/mm/yyyy · hh:mm:ss"
  box.querySelector('.t-time').textContent =
    [now.getDate(), now.getMonth() + 1, now.getFullYear()].map(pad).join('/') + ' · ' + hms(now);
  box.querySelector('.t-ttl').textContent = title;
  box.querySelector('.t-sub').textContent = sub || '';

  const kill = () => box.remove();
  const goBtn = box.querySelector('.go');
  const clip = ev && videoOf(ev) ? ev : null;
  if (clip) {
    goBtn.textContent = 'Xem lại';
    goBtn.onclick = () => { kill(); openVideo(clip); };   // tu mo detail dung camera
  } else if (name) {
    goBtn.onclick = () => { kill(); openDetail(name); };
  } else {
    goBtn.remove();
  }

  if (img) {
    const shot = box.querySelector('.t-shot');
    const im = document.createElement('img');
    im.className = 't-img';
    im.alt = 'Ảnh phát hiện từ ' + (sub || 'camera');
    if (clip) im.onclick = () => { kill(); openVideo(clip); };
    else if (name) im.onclick = () => { kill(); openDetail(name); };
    // THU TU QUAN TRONG: chen vao DOM va gan onerror TRUOC khi gan src.
    shot.prepend(im);
    im.onerror = () => im.remove();
    im.src = img;
  } else {
    box.querySelector('.t-shot').remove();   // loi he thong khong co anh -> bo khung anh
  }

  // Design chi giu MOT popup: cai moi thay cai cu (khong xep chong).
  $('#toasts').replaceChildren(box);
  setTimeout(kill, kind === 'ok' ? 6000 : 20000);
  return kill;
}

// Chi ghi lai trang thai, KHONG popup. Mat/khoi phuc ket noi da thay ro o badge
// tren tile + bo loc "Co loi"; popup moi lan ngat/noi lai chi gay on.
export function onStateChange(name, t) {
  S.seen[name] = t.state;
}

/* ================= them camera (modal) ================= */

const M = {media: '', test: 'idle', rows: null, added: 0};
const validRtsp = u => /^rtsp:\/\/\S+$/i.test(u);
const putStream = (name, src) => fetch(
  API + '?name=' + encodeURIComponent(name) + '&src=' + encodeURIComponent(src),
  {method: 'PUT'});

// Luồng tạm thời (_probe_...) và trình phát video xem thử trên modal thêm camera.
let probeStreamName = null;
let probePlayer = null;

/**
 * Dọn dẹp luồng xem thử tạm thời khỏi go2rtc và gỡ trình phát video khỏi DOM
 * khi đóng modal, đổi thông số URL/pass hoặc hoàn tất thêm camera.
 */
function stopModalPreview() {
  if (probePlayer) {
    try { probePlayer.src = ''; probePlayer.remove(); } catch {}
    probePlayer = null;
  }
  if (probeStreamName) {
    const stream = probeStreamName;
    probeStreamName = null;
    fetch(API + '?src=' + encodeURIComponent(stream), {method: 'DELETE'}).catch(() => {});
  }
  const msgEl = $('#mPrevMsg');
  if (msgEl) msgEl.style.display = '';
}

/**
 * Vẽ thông tin modal thêm camera: phát video xem thử trực tiếp bằng <video-stream>,
 * cập nhật thông số codec/độ phân giải khi live hoặc báo lỗi nếu RTSP thất bại.
 */
function paintModal() {
  const msg = {idle: 'Chưa kiểm tra · bấm "Kiểm tra kết nối"', testing: 'Đang thử kết nối…',
               invalid: 'URL phải bắt đầu bằng rtsp://', ok: 'Đang kết nối luồng…',
               bad: 'Không kết nối được'}[M.test];
  const msgEl = $('#mPrevMsg');
  if (msgEl) msgEl.textContent = msg;
  const r = M.rows;
  $('#mRows').innerHTML = !r ? row('—', 'chưa có dữ liệu', 'none')
    : r.err ? row('Lỗi', String(r.err).slice(0, 60), 'err')
    : row('Codec', r.codec || '—') + row('Phân giải', r.res || '—') +
      row('Âm thanh', r.audio ? 'có' : 'không', r.audio ? '' : 'none');

  if (M.test === 'ok' && probeStreamName) {
    const container = $('#mPrev');
    if (container) {
      if (msgEl) {
        msgEl.style.display = '';
        msgEl.style.zIndex = '1';
        msgEl.textContent = 'Đang kết nối & chờ khung hình từ camera…';
      }
      container.style.position = 'relative';
      container.style.overflow = 'hidden';
      if (!probePlayer || !probePlayer.isConnected) {
        if (probePlayer) { try { probePlayer.remove(); } catch {} }
        probePlayer = document.createElement('video-stream');
        probePlayer.mode = 'webrtc,mse';
        probePlayer.media = 'video';
        probePlayer.style.position = 'absolute';
        probePlayer.style.inset = '0';
        probePlayer.style.width = '100%';
        probePlayer.style.height = '100%';
        probePlayer.style.display = 'block';
        probePlayer.style.borderRadius = 'inherit';
        probePlayer.style.zIndex = '2';

        probePlayer.addEventListener('state', e => {
          const st = e.detail?.state;
          if (st === 'live') {
            if (msgEl) msgEl.style.display = 'none';
            fetch(API).then(res => res.json()).then(j => {
              const o = j[probeStreamName] || {};
              const pr = o.producers?.[0];
              const rx = (pr?.receivers || []).find(x => x.codec?.codec_type === 'video');
              M.rows = {
                codec: rx ? nice(rx.codec.codec_name) : null,
                res: rx?.codec?.width ? rx.codec.width + '×' + rx.codec.height : null,
                audio: (pr?.medias || []).some(m => m.startsWith('audio'))
              };
              const r = M.rows;
              $('#mRows').innerHTML = row('Codec', r.codec || '—') + row('Phân giải', r.res || '—') +
                row('Âm thanh', r.audio ? 'có' : 'không', r.audio ? '' : 'none');
            }).catch(() => {});
          } else if (st === 'error') {
            M.test = 'bad';
            M.rows = {err: e.detail?.error || 'Không thể mở luồng RTSP'};
            stopModalPreview();
            paintModal();
          }
        });

        container.appendChild(probePlayer);
      }
      probePlayer.src = new URL(G + 'api/ws?src=' + encodeURIComponent(probeStreamName), location.href);
    }
  } else if (M.test !== 'ok') {
    stopModalPreview();
  }
}

/**
 * Ghep username/password tu #mUser/#mPass vao URL RTSP neu URL chua co '@'.
 * Neu URL da co credential thi giu nguyen, khong ghi de.
 */
function buildRtspUrl() {
  const base = $('#mUrl').value.trim();
  const user = $('#mUser').value.trim();
  const pass = $('#mPass').value;  // giu nguyen, _add_channel se escape %
  if (!user || base.includes('@')) return base;
  try {
    const u = new URL(base);
    u.username = user;
    u.password = pass;
    return u.toString();
  } catch {
    // URL chua hop le (dang nhap do), tra nguyen ban
    return base;
  }
}

function openModal() {
  stopModalPreview();
  M.test = 'idle'; M.rows = null;
  $('#mUrl').value = ''; $('#mName').value = '';
  $('#mUser').value = ''; $('#mPass').value = ''; $('#mCustom').value = '';
  paintModal();
  $('#modal').hidden = false;
  $('#mUrl').focus();
}

/** Mo modal them camera voi URL/ten da dien san (tu Auto Search). */
function prefillModal(url, name) {
  stopModalPreview();
  M.test = 'idle'; M.rows = null;
  $('#mUrl').value = url; $('#mName').value = name;
  $('#mUser').value = ''; $('#mPass').value = ''; $('#mCustom').value = '';
  paintModal();
  $('#modal').hidden = false;
  $('#mUrl').focus();
}

/* ================= Auto Search camera (V1 DiscoverDevice) ================= */

// Box quet LAN tim camera: PUT kich hoat, GET lay ket qua. Ca hai deu la endpoint
// V1 (khong co trong PDF) — bridge proxy qua /api/discover + /api/discover/list.
async function scanNetwork() {
  const box = $('#discoverBox'), btn = $('#discoverBtn');
  if (!box.hidden && box.dataset.scanning !== 'true') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.dataset.scanning = 'true';
  btn.disabled = true;

  const renderHead = (contentHtml) => {
    box.innerHTML = '<div class="d-head" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:8px">' +
      '<span style="font:600 13px/1.4 var(--b);color:var(--fg1)">Camera quét được trong mạng LAN</span>' +
      '<button id="discoverClose" style="background:none;border:none;color:var(--ghost);cursor:pointer;font-size:15px;padding:2px 6px;line-height:1">✕</button>' +
      '</div>' + contentHtml;
    const closeBtn = box.querySelector('#discoverClose');
    if (closeBtn) {
      closeBtn.onmouseenter = () => closeBtn.style.color = 'var(--fg1)';
      closeBtn.onmouseleave = () => closeBtn.style.color = 'var(--ghost)';
      closeBtn.onclick = (e) => { e.stopPropagation(); box.hidden = true; };
    }
  };

  renderHead('<div class="al-load">Đang quét mạng…</div>');

  try {
    const s = await cnPost('api/discover', {});
    if (s.code !== 0) throw new Error(s.msg || 'code ' + s.code);
    const j = await cnPost('api/discover/list', {});
    if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
    const devs = j.data || [];
    if (!devs.length) {
      renderHead('<div class="al-load">Không tìm thấy camera nào trên mạng</div>');
      return;
    }
    
    renderHead('<div id="discoverList"></div>');
    const listEl = box.querySelector('#discoverList');
    listEl.replaceChildren(...devs.map(d => {
      const el = document.createElement('div');
      el.className = 'd-row';
      el.innerHTML = '<div class="d-main"><div class="d-l1"><span class="d-ip"></span>' +
        '<span class="d-st"></span></div><span class="d-l2"></span></div>' +
        '<button class="d-add">Thêm</button>';
      el.querySelector('.d-ip').textContent = d.addr || d.ip;
      el.querySelector('.d-st').textContent = d.manufacturer || '—';
      el.querySelector('.d-l2').textContent =
        (d.manufacturer || '—') + ' · ' + (d.addr || d.ip) + ' · chưa thêm vào box';
      el.querySelector('.d-add').onclick = () => {
        box.hidden = true;
        prefillModal('rtsp://' + d.ip + ':554/', d.ip);
      };
      return el;
    }));
  } catch (e) {
    renderHead('<div class="al-load" style="color:var(--err2)">Không quét được: ' + e.message + '</div>');
  } finally {
    delete box.dataset.scanning;
    btn.disabled = false;
  }
}

// Thu bang chinh go2rtc: PUT ten tam va de player <video-stream> mo luong & bao loi truc tiep.
async function testUrl(src) {
  stopModalPreview();
  const tmp = '_probe_' + Date.now();
  try {
    const p = await putStream(tmp, src);
    if (!p.ok) return {err: (await p.text()) || 'PUT ' + p.status};
    probeStreamName = tmp;
    return {ok: true};
  } catch (e) {
    return {err: e.message};
  }
}

export async function removeStream(name) {
  const cid = chIdOf(name);
  if (!cid) return alert('Luồng ' + name + ' không phải camera box (không có channel_id)');
  if (!confirm('Xoá camera "' + name + '" khỏi box?')) return;
  const r = await cnPost('aibox/channel/delete', {channel_id_list: [cid]});
  if (r.code !== 0) return alert(r.msg || 'Lỗi ' + r.code);
  // Box da bo -> go2rtc cung bo luong cu khoi bi treo den khi sync_streams chay.
  fetch(API + '?src=' + encodeURIComponent(name), {method: 'DELETE'}).catch(() => {});
  if (S.focus === name) go('live');
  await refresh();
  if (S.view === 'cam') loadCams();
  toast({kind: 'ok', sev: 'ĐÃ XOÁ', title: 'Đã xoá camera ' + name});
}

/* ================= poll go2rtc ================= */

async function refresh() {
  try {
    const j = await pollStreams();
    // Bỏ qua các luồng tạm (_probe_...) kiểm tra kết nối, không vẽ lên lưới Home
    const names = Object.keys(j).filter(n => !n.startsWith('_probe_')).sort();
    const changed = names.join() !== S.order.join();
    S.order = names;
    if (changed) drawGrid();
    else [...S.tiles.keys()].forEach(paintTile);

    const live = S.order.filter(n => tileState(n) === 'live').length;
    $('#cOnline').textContent = live + '/' + S.order.length + ' LUỒNG PHÁT';
    $('#dGo').style.background = 'var(--ok)';
    $('#dGo').style.animation = 'omPulse 2s ease-in-out infinite';
    if (S.view === 'detail') paintDetail();
    // Vẽ lại badge đếm người ở đây chứ không chỉ trong markTiles: refresh() chạy mỗi 3s,
    // chạy lúc boot, và chạy sau drawGrid (đổi trang/lọc/số cột làm tile dựng lại).
    // Nhờ vậy badge không phụ thuộc vào việc CÓ SSE event tới hay không.
    paintAreaBadge();
    paintRail();
  } catch {
    $('#cOnline').textContent = 'GO2RTC KHÔNG PHẢN HỒI';
    $('#dGo').style.background = 'var(--err)';
    $('#dGo').style.animation = 'none';
  }
}

$('#camRefresh').onclick = async () => {
  const b = $('#camRefresh');
  b.classList.add('spin');
  const t0 = performance.now();
  try {
    await refresh();
    // Nút "Làm mới" = reload lại luồng video thật: gán lại src cho <video-stream>
    // (setter src -> onconnect() -> WebSocket/WebRTC nối lại) nên camera hiện rõ
    // việc refresh (video re-buffer). Không làm trong auto-refresh 3s.
    for (const [name, t] of S.tiles) {
      if (t.player && t.box.isConnected)
        t.player.src = new URL(G + 'api/ws?src=' + encodeURIComponent(name), location.href);
    }
  } finally {
    // pollStreams() thường resolve trong vài ms (kết nối nóng) -> nếu bỏ spin ngay
    // thì icon chưa kịp quay 1 khung hình. Giữ spin ít nhất 600ms để người dùng
    // thấy rõ nút đang làm mới.
    const rest = 600 - (performance.now() - t0);
    if (rest > 0) await new Promise(r => setTimeout(r, rest));
    b.classList.remove('spin');
  }
};

/* ================= wiring chung ================= */

$$('nav button').forEach(b => b.onclick = () => {
  if (b.dataset.go === 'log') markAllSeen();
  go(b.dataset.go);
});
$('#back').onclick = () => { stopVideo(); go('live'); };

document.addEventListener('click', e => {
  const box = $('#discoverBox'), btn = $('#discoverBtn');
  if (box && !box.hidden && !box.contains(e.target) && !btn.contains(e.target)) {
    box.hidden = true;
  }
});

/* ============ bảng thông báo trên icon chuông toolbar ============ */
const notifBellBtn = $('#notifBellBtn');
const notifPanel = $('#notifPanel');
const notifList = $('#notifList');
// Các thẻ người dùng đã "Đã xem" — lưu vào localStorage để không bị mất khi F5 / tải lại trang.
const SEEN = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('vbt_seen_notifs') || '[]');
  if (Array.isArray(saved)) saved.forEach(k => SEEN.add(k));
} catch { /* private mode */ }

function saveSeen() {
  try {
    const list = Array.from(SEEN).slice(-500);
    localStorage.setItem('vbt_seen_notifs', JSON.stringify(list));
  } catch { /* private mode */ }
}

if (notifBellBtn) {
  notifBellBtn.onclick = e => {
    e.stopPropagation();
    if (!notifPanel.hidden) { notifPanel.hidden = true; return; }
    renderNotif();
    const rect = notifBellBtn.getBoundingClientRect();
    notifPanel.style.top = (rect.bottom + 8) + 'px';
    notifPanel.style.right = '18px';
    notifPanel.style.bottom = 'auto';
    notifPanel.style.maxHeight = `calc(100vh - ${rect.bottom + 26}px)`;
    notifPanel.hidden = false;
  };
}
if (notifPanel) {
  notifPanel.onclick = e => e.stopPropagation();
}

function updateUnreadBadge() {
  const unreadList = alarms().filter(a => isDetect(a) && !SEEN.has(notifKey(a)));
  unread = unreadList.length;
  const txt = unread > 99 ? '99+' : String(unread);
  const show = unread > 0;

  const bellB = $('#navUnread');
  const dockB = $('#dockUnread');
  const bellBtn = $('#notifBellBtn');

  if (bellB) { bellB.hidden = !show; bellB.textContent = txt; }
  if (dockB) { dockB.hidden = !show; dockB.textContent = txt; }
  if (bellBtn) { bellBtn.classList.toggle('has-unread', show); }

  paintRail();
}

// "Đã xem": đánh dấu mọi thẻ hiện tại là đã đọc + xoá badge chưa đọc.
// Dùng chung cho nút trong panel thông báo và nút trên toolbar nhật ký.
function markAllSeen() {
  alarms().filter(isDetect).forEach(a => SEEN.add(notifKey(a)));
  saveSeen();
  FRESH.clear();                 // xoá luôn chip "MỚI" trên các dòng nhật ký
  updateUnreadBadge();
  if (S.view === 'log') loadLog();   // đang ở nhật ký -> vẽ lại để bỏ chip "MỚI"
  renderNotif();
}
$('#notifReadAll').onclick = e => { e.stopPropagation(); markAllSeen(); };
$('#logReadAll').onclick = () => markAllSeen();

$('#notifDetail').onclick = e => {
  e.stopPropagation();
  notifPanel.hidden = true;
  markAllSeen();
  go('log');
};

// Khóa nhận diện cho thẻ thông báo — giống tlRow: event_id nếu có, else ts.
const notifKey = a => a.event_id != null ? String(a.event_id) : 'ts' + (a.ts || '0');

function renderNotif() {
  const rows = alarms().filter(isDetect).slice(0, 9);
  if (!rows.length) {
    const h = document.createElement('div');
    h.className = 'notif-empty';
    h.textContent = 'Chưa có cảnh báo nào từ AI box';
    notifList.replaceChildren(h);
    return;
  }
  notifList.replaceChildren(...rows.map(a => {
    const card = document.createElement('div');
    card.className = 'notif-card';
    const key = notifKey(a);
    const unreadDot = document.createElement('span');
    unreadDot.className = 'notif-unread';
    unreadDot.textContent = 'MỚI';
    unreadDot.hidden = SEEN.has(key);
    const dot = document.createElement('span');
    dot.className = 'notif-dot';
    dot.style.background = dot.style.color = colorOf(a.algo_model);
    const b = document.createElement('div');
    b.className = 'notif-b';
    const t = document.createElement('div');
    t.className = 'notif-t';
    t.textContent = algoName(a.algo_model, a.algo_name) || a.label || '—';
    const d = new Date((a.ts || 0) * 1000);
    const s = document.createElement('div');
    s.className = 'notif-s';
    const cName = a.channel_name || camOf(a);
    s.textContent = [cName ? ('Khu vực: ' + cName) : '', a.ipc_addr,
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())]
      .filter(Boolean).join(' · ') || '—';
    b.append(t, s);
    // "MỚI" nằm SÁT PHẢI (sau dot + nội dung), sáng nhờ CSS .notif-unread.
    card.append(dot, b, unreadDot);
    card.onclick = () => {
      SEEN.add(key);
      saveSeen();
      updateUnreadBadge();
      renderNotif();
      notifPanel.hidden = true;
      go('log');
      highlightLog(key);
    };
    return card;
  }));
}

// Cuộn tới và highlight thẻ vừa chọn trong view log (sau go() đã paint lại).
function highlightLog(key) {
  const row = $('#logBox').querySelector('.tl-row[data-id="' + key + '"]');
  if (!row) return;
  row.scrollIntoView({block: 'center', behavior: 'smooth'});
  row.classList.add('hl');
  setTimeout(() => row.classList.remove('hl'), 3400);
}

$('#fList').replaceChildren(...FILTERS.map(f => {
  const b = document.createElement('div');
  b.className = 'mrow' + (f.k === S.filter ? ' on' : '');
  b.innerHTML = '<span class="l"></span><span class="k"></span>';
  b.querySelector('.l').textContent = f.l;
  b.onclick = () => {
    S.filter = f.k; S.page = 0;
    $('#fMenu').hidden = true;
    $$('#fList .mrow').forEach((x, i) => x.classList.toggle('on', FILTERS[i].k === f.k));
    drawGrid();
  };
  return b;
}));

$('#fBtn').onclick = e => {
  e.stopPropagation();
  $$('#fList .mrow').forEach((b, i) => {
    const k = FILTERS[i].k;
    b.querySelector('.k').textContent = String(S.order.filter(n =>
      k === 'live' ? tileState(n) === 'live' : k === 'down' ? isDown(n) : true).length);
  });
  const m = $('#fMenu');
  m.hidden = !m.hidden;
  $('#fBtn').style.borderColor = m.hidden ? '' : 'var(--gold3)';
};
$('#fMenu').onclick = e => e.stopPropagation();
document.addEventListener('click', () => {
  $('#fMenu').hidden = true;
  $('#fBtn').style.borderColor = '';
  $('#layoutMenu').hidden = true;
  $('#layoutBtn').style.borderColor = '';
});

// Bố cục lưới: nút dropdown mở 3 lựa chọn (2x2/3x3/4x4) như nút lọc.
const LAYOUTS = [[2, '2×2'], [3, '3×3'], [4, '4×4']];
$('#layoutList').replaceChildren(...LAYOUTS.map(([c, l]) => {
  const b = document.createElement('div');
  b.className = 'mrow' + (c === S.cols ? ' on' : '');
  b.innerHTML = '<span class="l"></span><span class="k"></span>';
  b.querySelector('.l').textContent = l;
  b.onclick = () => {
    S.cols = c; S.page = 0;
    $('#layoutLabel').textContent = l;
    $('#layoutMenu').hidden = true;
    $('#layoutBtn').style.borderColor = '';
    $$('#layoutList .mrow').forEach(x => x.classList.toggle('on', x === b));
    drawGrid();
  };
  return b;
}));
$('#layoutBtn').onclick = e => {
  e.stopPropagation();
  const m = $('#layoutMenu');
  m.hidden = !m.hidden;
  $('#layoutBtn').style.borderColor = m.hidden ? '' : 'var(--gold3)';
};
$('#layoutMenu').onclick = e => e.stopPropagation();
$('#pgPrev').onclick = () => { if (S.page > 0) { S.page--; drawGrid(); } };
$('#pgNext').onclick = () => { S.page++; drawGrid(); };

$('#addBtn').onclick = openModal;
$('#discoverBtn').onclick = scanNetwork;
const closeModal = () => { stopModalPreview(); $('#modal').hidden = true; };
$('#mClose').onclick = $('#mCancel').onclick = closeModal;
$('#modal').onclick = e => { if (e.target === $('#modal')) closeModal(); };
$$('#mMedia button').forEach(b => b.onclick = () => {
  M.media = b.dataset.media;
  $$('#mMedia button').forEach(x => x.classList.toggle('on', x === b));
  stopModalPreview();
});
$('#mUrl').oninput = $('#mUser').oninput = $('#mPass').oninput = () => { stopModalPreview(); M.test = 'idle'; M.rows = null; paintModal(); };

// '#video' la query cua go2rtc: bo track audio ngay o nguon
// buildRtspUrl() da ghep user/pass vao URL neu can.
const srcOf = () => {
  const u = fixPct(buildRtspUrl());
  return M.media === 'video' && !u.includes('#') ? u + '#video' : u;
};

$('#mTest').onclick = async () => {
  if (!validRtsp($('#mUrl').value.trim())) { M.test = 'invalid'; return paintModal(); }
  M.test = 'testing'; M.rows = null; paintModal();
  const r = await testUrl(srcOf());
  M.rows = r; M.test = r.err ? 'bad' : 'ok';
  paintModal();
};

// Them camera = tao channel TREN BOX (POST /api/v2/channel/add, type=2 rtsp truc tiep),
// khong con ghi thang vao go2rtc nua. Box la nguon that; luong go2rtc van ten
// ch<channel_id> theo quy uoc cua sync_streams(), nen UI ghep alarm <-> camera van chay.
$('#mAdd').onclick = async () => {
  // URL gui box: box percent-DECODE rtsp truoc khi luu, nen '%' trong password phai
  // thanh '%25' truoc khi gui (raw '%@' bi box tu choi 60062 Invalid Arguments).
  // Bridge _add_channel() tu escape. fixPct()/srcOf() chi dung cho go2rtc (no cung
  // can %25), khong gui len box.
  const url = buildRtspUrl(), name = $('#mName').value.trim();
  const customCode = $('#mCustom').value.trim();
  if (!validRtsp(url)) { M.test = 'invalid'; return paintModal(); }
  // Vendor web (AddChannel.3c964a69.js): nameRules = required + <=64 + not-blank.
  if (!name || !name.trim()) return alert('Tên channel: bắt buộc, không được chỉ toàn khoảng trắng');
  if (name.length > 64) return alert('Tên channel: tối đa 64 ký tự');
  // Vendor web: rtsp <=1023 bytes. NHUNG rtsp co credential dai -> validate chu, khong byte.
  if (url.length > 256) return alert('URL RTSP tối đa 256 ký tự (cẩn thận với credential dài)');
  const hint = $('#mHint').textContent;
  $('#mHint').textContent = 'Đang thêm vào box…';
  $('#mAdd').disabled = true;          // click doi = tao 2 channel trung tren box
  let j;
  try {
    const body = {channel_name: name, rtsp: url, transport_type: 1};
    if (customCode) body.custom_code = customCode;
    j = await cnPost('api/channel/add', body);
  } catch (e) {
    j = {code: -1, msg: e.message};
  } finally {
    $('#mAdd').disabled = false;
    $('#mHint').textContent = hint;
  }
  if (j.code !== 0) {
    return alert('Box từ chối: ' + (j.msg || 'code ' + j.code) +
                 (j.step ? `\n(bước ${j.step})` : '') + (j.hint ? '\n' + j.hint : ''));
  }
  const cid = (j.data || {}).channel_id;
  const stream = cid != null ? 'ch' + cid : null;
  // PHAI tu tao luong go2rtc, khong duoc doi sync_streams(): no bo qua channel moi
  // khi /channel/list chua tra `rtsp` (bang chung t_add.json: them channel_id 10
  // thanh cong nhung sync chi added:['ch9'] -> ch10 bien mat, grid trong khong).
  // srcOf() = fixPct(buildRtspUrl()) va them '#video' neu chon "Chi video" — '#video'
  // la cua go2rtc, box khong hieu, nen chi gan o day chu khong gui len box.
  if (stream) await putStream(stream, srcOf());
  stopModalPreview();
  $('#modal').hidden = true;
  await refresh();
  for (const [name, t] of S.tiles) {
    if (t.player && t.box.isConnected)
      t.player.src = new URL(G + 'api/ws?src=' + encodeURIComponent(name), location.href);
  }
  if (S.view === 'cam') loadCams();
  toast({kind: 'ok', sev: 'ĐÃ THÊM', title: 'Box đã nhận channel ' + name,
         sub: stream ? 'luồng ' + stream : '', name: stream && S.api[stream] ? stream : null});
};

/* detail: cac nut tren stage */
$('#dReload').onclick = () => S.focus && openDetail(S.focus);
$('#dAI').onclick = () => S.focus && openAI(S.focus);
$('#dAiCta').onclick = () => S.focus && openAI(S.focus);
$('#dPlay').onclick = () => {
  const v = dPlayer?.video;
  if (!v) return;
  v.paused ? v.play() : v.pause();
  $('#dPlay').textContent = v.paused ? '▶' : '⏸';
};
$('#dMute').onclick = () => {
  const v = dPlayer?.video;
  if (!v) return;
  v.muted = !v.muted;
  $('#dMute').textContent = v.muted ? '🔇' : '🔊';
};
$('#dFull').onclick = () => {
  const st = $('#stage');
  document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen?.();
};

const tick = () => $('#clock').textContent = hms(new Date());

/* ================= tab Camera: bang 7 cot ================= */

// Do tre KHONG co trong API box -> lay tu go2rtc (RTT WebRTC / bitrate).
const latOf = name => {
  const t = S.tiles.get(name);
  if (t?.player?.rtt != null) return t.player.rtt + ' ms';
  const b = S.bps[name];
  return b ? b.toFixed(1) + ' Mbps' : '—';
};

async function loadCams() {
  const list = $('#camList');
  list.innerHTML = '<div class="al-load">Đang đọc danh sách camera…</div>';
  try {
    const j = await cameraList();
    if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
    const cams = j.data || [];
    const hr = await hashrate(1, []).catch(() => ({}));
    const v = (hr.data || {}).hashrate;
    $('#camHr').textContent = v != null ? v + '%' : '—';
    $('#camHr').style.color = v == null ? '' : v < 20 ? 'var(--err2)'
      : v < 50 ? 'var(--warn)' : 'var(--ok)';
    const bar = $('#camHrBar');
    bar.style.width = (v == null ? 0 : v) + '%';
    bar.className = v == null ? '' : v < 20 ? 'err' : v < 50 ? 'warn' : '';

    list.replaceChildren(...cams.map(camRow));
  } catch (e) {
    list.innerHTML = '<div class="al-load" style="color:var(--err2)"></div>';
    list.firstChild.textContent = 'Không đọc được /api/cameras: ' + e.message;
  }
}

const SVG_GEAR = 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19 12a7 7 0 0 0-.1-1.1l1.8-1.4'
  + '-1.8-3.1-2.1.9a7 7 0 0 0-1.8-1.1L14.6 4H9.4l-.4 2.2a7 7 0 0 0-1.8 1.1l-2.1-.9L3.3 9.5l1.8 1.4'
  + 'a7 7 0 0 0 0 2.2l-1.8 1.4 1.8 3.1 2.1-.9a7 7 0 0 0 1.8 1.1L9.4 20h5.2l.4-2.2a7 7 0 0 0 1.8-1.1'
  + 'l2.1.9 1.8-3.1-1.8-1.4A7 7 0 0 0 19 12';
const SVG_CAM = 'M3.4 7.6h11.2v8.8H3.4zM14.6 10.6l6-2.6v8.4l-6-2.6';
const SVG_PENCIL = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41'
  + 'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const SVG_TRASH = 'M5 7h14M9.5 7V4.4h5V7M7 7l1 13h8l1-13M11 10.5v6M13 10.5v6';
const icoHtml = (cls, title, path) => '<span class="ico ' + cls + '" title="' + title +
  '"><svg viewBox="0 0 24 24"><path d="' + path + '"/></svg></span>';

function camRow(c) {
  const el = document.createElement('div');
  el.className = 'trow';
  const algos = c.algos || [], nm = c.stream;
  el.innerHTML =
    '<span class="c-id"></span>' +
    '<div style="min-width:0"><div class="c-nm"></div><div class="c-md"></div>' +
      '<div class="c-algos"></div></div>' +
    '<span class="c-zone"></span><span class="c-url"></span><span class="c-lat"></span>' +
    '<span class="c-st"><span class="dot"></span><span class="s"></span></span>' +
    '<div class="c-act">' +
      '<span class="c-aibtn" data-goldbtn title="Cấu hình AI"><svg viewBox="0 0 24 24"><path d="' +
        SVG_GEAR + '"/></svg>Cấu hình AI</span>' +
      icoHtml('', 'Chỉnh sửa camera', SVG_PENCIL) +
      icoHtml('rm', 'Xoá camera', SVG_TRASH) +
    '</div>';
  el.querySelector('.c-id').textContent = nm;
  el.querySelector('.c-nm').textContent = c.name || '—';
  el.querySelector('.c-md').textContent = c.model || c.ip || '';
  // Box khong co field "Khu vuc" -> dung channel_name (nguoi dung dat theo vi tri)
  el.querySelector('.c-zone').textContent = c.name || '—';
  el.querySelector('.c-url').textContent = mask(S.api[nm]?.producers?.[0]?.url || '—');
  el.querySelector('.c-lat').textContent = latOf(nm);
  const st = el.querySelector('.c-st');
  st.className = 'c-st ' + (c.status === 1 ? '' : 'off');
  st.querySelector('.s').textContent = c.status === 1 ? 'ONLINE' : 'OFFLINE';

  // Design chỉ hiện SỐ thuật toán trên dòng phụ, không liệt kê chip: vài hàng ×
  // vài chip mỗi hàng là nhiễu thị giác; chi tiết từng thuật toán đã có trong
  // panel Cấu hình AI của chính camera đó.
  el.querySelector('.c-algos').textContent =
    algos.length ? algos.length + ' thuật toán AI' : 'chưa bật AI';
  const [cfg, view, del] = el.querySelectorAll('.c-act > *');
  // openAI() suy channel_id tu ten stream ch<id> nen phai truyen dung dang do
  cfg.onclick = e => { e.stopPropagation(); openAI(nm); };
  view.onclick = e => { e.stopPropagation(); openEdit(c); };
  del.onclick = e => { e.stopPropagation(); removeStream(nm); };
  // Bấm vào thẻ = xem stream (hành vi mong đợi khi click một camera).
  // Cấu hình AI vẫn ở icon bánh xe.
  el.onclick = () => openDetail(nm);
  return el;
}

/* ================= sua camera (form chinh sua) ================= */

const EC = {cid: null, stream: '', rtsp: '', transport: 1};

function openEdit(c) {
  EC.cid = c.channel_id; EC.stream = c.stream; EC.rtsp = c.rtsp || '';
  $('#eTitle').textContent = c.stream + ' · ' + (c.name || '—');
  $('#eName').value = c.name || '';
  $('#eRtsp').value = mask(c.rtsp || '');
  $('#eUser').value = c.username || '';
  $('#ePass').value = '';
  $('#eCustom').value = c.custom_code || '';
  EC.transport = c.transport_type === 2 ? 2 : 1;
  $$('#eTransport button').forEach(b =>
    b.classList.toggle('on', +b.dataset.t === EC.transport));
  $('#eHint').textContent = '';
  $('#editModal').hidden = false;
  $('#eName').focus();
}

$$('#eTransport button').forEach(b => b.onclick = () => {
  EC.transport = +b.dataset.t;
  $$('#eTransport button').forEach(x => x.classList.toggle('on', x === b));
});
$('#eClose').onclick = $('#eCancel').onclick = () => $('#editModal').hidden = true;
$('#editModal').onclick = e => { if (e.target === $('#editModal')) $('#editModal').hidden = true; };

$('#eSave').onclick = async () => {
  const name = $('#eName').value.trim();
  const shown = $('#eRtsp').value.trim();
  const rtsp = mergeRtsp(EC.rtsp, shown, $('#eUser').value.trim(), $('#ePass').value);
  if (!name) return alert('Channel Name: bắt buộc');
  if (name.length > 64) return alert('Channel Name: tối đa 64 ký tự');
  if (!/^rtsp:\/\/\S+$/i.test(rtsp)) return alert('RTSP URL: không hợp lệ (không tìm thấy mật khẩu cũ?)');
  if (rtsp.length > 256) return alert('RTSP URL: tối đa 256 ký tự');
  const hint = $('#eHint').textContent;
  $('#eHint').textContent = 'Đang lưu…';
  $('#eSave').disabled = true;              // click doi = 2 lan update
  let j;
  try {
    j = await cnPost('api/channel/update', {
      channel_id: EC.cid, channel_name: name, rtsp,
      transport_type: EC.transport, custom_code: $('#eCustom').value.trim(),
    });
  } catch (e) {
    j = {code: -1, msg: e.message};
  } finally {
    $('#eSave').disabled = false;
    $('#eHint').textContent = hint;
  }
  if (j.code !== 0) return alert('Box từ chối: ' + (j.msg || 'code ' + j.code));
  $('#editModal').hidden = true;
  // URL vua doi -> luong go2rtc van giu src cu; PUT lai de khoi can restart.
  await putStream(EC.stream, fixPct(rtsp));
  await refresh();
  if (S.view === 'cam') loadCams();
  toast({kind: 'ok', sev: 'ĐÃ LƯU', title: 'Đã cập nhật ' + name, sub: EC.stream});
};

/* ================= nhat ky ================= */

export async function loadLog() {
  await loadAlarmHistory().catch(() => {});
  paintAlarms();
}

// Mau cham moc theo nhom thuat toan. Key phai khop CHINH XAC ALGO_CAT trong
// ai.js — 8 nhom, khong phai ten tu dat.
const KIND_COLOR = {
  'Chức năng chung': '#d9a233',
  'Môi trường': '#5fe3d0',
  'Bảo hộ lao động (PPE)': '#ff4d4f',
  'Hành vi': '#e8a020',
  'Phương tiện': '#7aa2f7',
  'Sự kiện đường cao tốc': '#c48a29',
  'Thuỷ lợi / Quản lý đô thị': '#3ddc97',
  'AlertFree': '#8b9aa8',
  'Khác': '#8b9aa8',
};
const colorOf = m => {
  const g = algoGroups([m])[0];
  return KIND_COLOR[g?.cat] || KIND_COLOR['Khác'];
};

// Nhung alarm vua toi trong phien nay -> chip "MỚI"
const FRESH = new Set();
// Bo loc Nhat ky: 2 Set doc lap, null = "tat ca". Logic khop nam o logMatch()
// trong ai.js — do la file co selftest chay bang node.
let logCams = null;    // Set camKey ('ch1'..'ch8' / '?')
let logAlgos = null;   // Set algoKey (algo_model / '?')

/** Bat/tat 1 muc loc. allKeys = toan bo muc dang co.
 *  Dang "tat ca" (null) ma bam 1 muc -> chon tat ca TRU muc do, dung y nhu ban
 *  loc 3 nhom truoc day. Chon het hoac bo het -> tra ve null, de canh bao MOI
 *  tu hien lai chu khong bi ket trong trang thai da loc. */
function toggleIn(sel, key, allKeys) {
  const s = new Set(sel || allKeys);
  if (s.has(key)) s.delete(key); else s.add(key);
  return (s.size === 0 || s.size === allKeys.length) ? null : s;
}

function paintAlarms() {
  const box = $('#logBox');
  const all = alarms().filter(isDetect);
  // Don bo loc: bo muc khong con xuat hien, va chon het thi ve null.
  const camKeys = new Set(all.map(camKey));
  const algoKeys = new Set(all.map(algoKey));
  if (logCams) {
    logCams = new Set([...logCams].filter(k => camKeys.has(k)));
    if (logCams.size === 0 || logCams.size === camKeys.size) logCams = null;
  }
  if (logAlgos) {
    logAlgos = new Set([...logAlgos].filter(k => algoKeys.has(k)));
    if (logAlgos.size === 0 || logAlgos.size === algoKeys.size) logAlgos = null;
  }
  paintLogFilter(all);
  const rows = all.filter(a => logMatch(a, logCams, logAlgos)).slice(0, 150);
  if (!rows.length) {
    box.innerHTML = '<div class="hint">Chưa có cảnh báo nào từ AI box</div>';
    return;
  }
  const d0 = new Date((rows[0].ts || 0) * 1000);
  const head = document.createElement('div');
  head.className = 'tl-day';
  head.innerHTML = '<span class="d"></span><div class="ln"></div>';
  head.querySelector('.d').textContent =
    'Hôm nay · ' + pad(d0.getDate()) + '/' + pad(d0.getMonth() + 1);

  const tl = document.createElement('div');
  tl.className = 'tl';
  tl.replaceChildren(...rows.map(tlRow));
  box.replaceChildren(head, tl);
}

/* Menu loc 2 khuc. CAMERA lay nhan tu channel_name — dung cai dong log dang hien
   (vd '001'), khong phai 'ch1'. HANH VI: nhom -> tung hanh vi; bam hang nhom =
   chon/bo CA NHOM nen thao tac cu (loc theo 3 nhom) van lam duoc y nguyen.
   Danh sach dung tu chinh cac alarm dang co -> chi hien thu da tung xay ra. */
function paintLogFilter(all) {
  const list = $('#logFilterList');
  if (!list) return;

  const mk = (cls, label, n, color, onclick) => {
    const b = document.createElement('div');
    b.className = 'mrow' + (cls ? ' ' + cls : '');
    b.innerHTML = '<span class="dot"></span><span class="l"></span><span class="k"></span>' +
      '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="#2a2410" stroke-width="2.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
    b.querySelector('.dot').style.background = color;
    b.querySelector('.l').textContent = label;
    b.querySelector('.k').textContent = String(n);
    if (onclick) b.onclick = e => { e.stopPropagation(); onclick(); };
    else b.classList.add('ro');            // tieu de khuc: khong bam duoc
    return b;
  };
  const sec = t => { const d = document.createElement('div'); d.className = 'msec'; d.textContent = t; return d; };
  const sep = () => { const d = document.createElement('div'); d.className = 'msep'; return d; };

  // --- gom tu chinh du lieu dang co ---
  const cams = new Map();                  // camKey -> {label, n}
  const byCat = new Map();                 // cat -> Map(algoKey -> {label, n})
  for (const a of all) {
    const ck = camKey(a);
    const ce = cams.get(ck);
    if (ce) ce.n++;
    else cams.set(ck, {label: ck === '?' ? 'Không rõ' : (a.channel_name || ck), n: 1});

    const cat = algoGroups([a.algo_model])[0]?.cat || 'Khác';
    const ak = algoKey(a);
    let m = byCat.get(cat);
    if (!m) byCat.set(cat, m = new Map());
    const ae = m.get(ak);
    if (ae) ae.n++;
    else m.set(ak, {label: ak === '?' ? 'Không rõ' : algoName(a.algo_model, a.algo_name), n: 1});
  }
  // "duoc chon" chu khong phai "co dang loc": khi chua loc gi (null) thi MOI muc
  // deu dang duoc hien -> phai co dau het. Ban cu de trong het nen nhin nhu bi loai.
  const inc = (sel, k) => !sel || sel.has(k);
  const camAll  = [...cams.keys()];
  const algoAll = [...byCat.values()].flatMap(m => [...m.keys()]);
  const chNum = k => (k === '?' ? 1e9 : (parseInt(k.slice(2), 10) || 0));

  const rows = [sec('Camera')];
  [...cams.keys()].sort((x, y) => chNum(x) - chNum(y)).forEach(k => {
    const c = cams.get(k);
    rows.push(mk(inc(logCams, k) ? 'on' : '', c.label, c.n, KIND_COLOR['Khác'], () => {
      logCams = toggleIn(logCams, k, camAll);
      paintAlarms();
    }));
  });

  rows.push(sep(), sec('Hành vi'));
  [...byCat.keys()].sort().forEach(cat => {
    const m = byCat.get(cat), keys = [...m.keys()];
    const color = KIND_COLOR[cat] || KIND_COLOR['Khác'];
    const total = [...m.values()].reduce((sum, x) => sum + x.n, 0);
    const on = keys.every(k => inc(logAlgos, k));
    rows.push(mk(on ? 'on' : '', cat, total, color, () => {     // bam = ca nhom
      const s = new Set(logAlgos || algoAll);
      keys.forEach(k => { if (on) s.delete(k); else s.add(k); });
      logAlgos = (s.size === 0 || s.size === algoAll.length) ? null : s;
      paintAlarms();
    }));
    keys.forEach(k => {
      const e = m.get(k);
      rows.push(mk('sub' + (inc(logAlgos, k) ? ' on' : ''), e.label, e.n, color, () => {
        logAlgos = toggleIn(logAlgos, k, algoAll);
        paintAlarms();
      }));
    });
  });
  list.replaceChildren(...rows);

  const lbl = $('#logFilterLabel');
  if (lbl) lbl.textContent = logFilterLabel(cams, byCat);
}

/** Nhan tren nut Loc: chon dung 1 muc thi hien TEN (doc de hon so dem), con lai dem. */
function logFilterLabel(cams, byCat) {
  const p = [];
  if (logCams) {
    p.push(logCams.size === 1 ? (cams.get([...logCams][0])?.label || '1 camera')
                              : logCams.size + ' camera');
  }
  if (logAlgos) {
    if (logAlgos.size > 1) p.push(logAlgos.size + ' hành vi');
    else {
      const k = [...logAlgos][0];
      let lbl = k;
      for (const m of byCat.values()) if (m.has(k)) { lbl = m.get(k).label; break; }
      p.push(lbl);
    }
  }
  return p.length ? p.join(' · ') : 'Tất cả';
}

$('#logFilter').onclick = e => {
  e.stopPropagation();
  const m = $('#logFilterMenu');
  m.hidden = !m.hidden;
  $('#logFilter').style.borderColor = m.hidden ? '' : 'var(--gold3)';
};
$('#logFilterMenu').onclick = e => e.stopPropagation();
document.addEventListener('click', e => {
  const m = $('#logFilterMenu');
  if (m) { m.hidden = true; $('#logFilter').style.borderColor = ''; }
  // Dong panel Telegram khi click ngoai (da stopPropagation tren #tgRefresh
  // va #tgPanel nen chi dong khi click o noi khac).
  const p = $('#tgPanel');
  if (p && !p.hidden && !p.contains(e.target)) p.hidden = true;
  const n = $('#notifPanel');
  if (n && !n.hidden && !n.contains(e.target) && !$('#notifBellBtn')?.contains(e.target)) n.hidden = true;
});
// Panel FIXED gan vao nut -> cuon trang ngoài thi dong, cuon TRONG panel thi GIU.
window.addEventListener('scroll', e => {
  const p = $('#tgPanel');
  if (p && !p.hidden && !p.contains(e.target)) p.hidden = true;
  const n = $('#notifPanel');
  if (n && !n.hidden && !n.contains(e.target)) n.hidden = true;
}, true);

function tlRow(a) {
  const t = new Date((a.ts || 0) * 1000);
  const col = colorOf(a.algo_model);
  const cam = camOf(a);
  const g = algoGroups([a.algo_model])[0];
  const catName = g?.cat || 'Khác';

  const el = document.createElement('div');
  el.className = 'tl-row';
  el.dataset.id = a.event_id != null ? String(a.event_id) : 'ts' + (a.ts || '0');
  el.innerHTML =
    '<div class="tl-t"><span class="tl-hm"></span><span class="tl-sec"></span></div>' +
    '<div class="tl-mid"><div class="ln"></div><span class="tl-dot"></span></div>' +
    '<div class="tl-b">' +
      '<div class="tl-th"><div class="no">không ảnh</div><div class="sc"></div><div class="box"></div>' +
        '<span class="cam"></span></div>' +
      '<div class="tl-mn">' +
        '<div class="tl-chips"></div>' +
        '<div class="tl-ttl"></div>' +
        '<div class="tl-sub"></div>' +
        '<div class="tl-det-box"></div>' +
      '</div>' +
      '<div class="tl-acts"></div>' +
    '</div>';

  // 1. Cột thời gian bên trái
  el.querySelector('.tl-hm').textContent = pad(t.getHours()) + ':' + pad(t.getMinutes());
  el.querySelector('.tl-sec').textContent = ':' + pad(t.getSeconds());

  // Chấm trạng thái phát sáng
  const dot = el.querySelector('.tl-dot');
  dot.style.background = col;
  dot.style.color = col;

  // 2. Khung hình ảnh Thumbnail & Overlays
  const th = el.querySelector('.tl-th');
  const cName = a.channel_name || cam || '';
  th.querySelector('.cam').textContent = cName ? ('Khu vực: ' + cName) : '';

  // Bounding box overlay từ capture_info
  const firstCap = Array.isArray(a.capture_info) ? a.capture_info[0] : null;
  const boxEl = th.querySelector('.box');
  if (firstCap && firstCap.x != null && firstCap.y != null && firstCap.w != null && firstCap.h != null) {
    boxEl.style.left = (firstCap.x * 100) + '%';
    boxEl.style.top = (firstCap.y * 100) + '%';
    boxEl.style.width = (firstCap.w * 100) + '%';
    boxEl.style.height = (firstCap.h * 100) + '%';
    boxEl.style.display = 'block';
  } else {
    boxEl.style.display = 'none';
  }

  const img = imgOf(a);
  if (img) {
    const im = document.createElement('img');
    im.alt = 'Ảnh phát hiện ' + (algoName(a.algo_model) || '');
    im.loading = 'lazy';
    im.onerror = () => im.remove();
    th.prepend(im);
    im.src = img;
  }

  // 3. Khối nội dung trung tâm
  const chips = el.querySelector('.tl-chips');

  // Rule Group Badge (Tên nhóm từ từ điển algoGroups)
  const ruleBadge = document.createElement('span');
  ruleBadge.className = 'tl-rule-badge';
  ruleBadge.textContent = (catName || 'Khác').toUpperCase();
  ruleBadge.style.color = col;
  ruleBadge.style.borderColor = col + '50';
  ruleBadge.style.background = col + '18';
  chips.append(ruleBadge);

  // Event ID (nếu có)
  if (a.event_id) {
    const evTag = document.createElement('span');
    evTag.className = 'tl-type-badge';
    evTag.style.color = 'var(--gold2)';
    evTag.style.borderColor = 'rgba(217,162,51,0.3)';
    evTag.textContent = '#' + a.event_id;
    chips.append(evTag);
  }

  // Mới Chip
  if (FRESH.has(a.event_id)) {
    const n = document.createElement('span');
    n.className = 'tl-new';
    n.textContent = 'MỚI';
    chips.append(n);
  }

  // Tiêu đề cảnh báo (Lấy từ từ điển algoName hoặc a.label của API)
  el.querySelector('.tl-ttl').textContent =
    algoName(a.algo_model, a.algo_name) || a.label || '—';

  // Subtitle: Thiết bị & IP từ API
  const subParts = [];
  const subCam = a.channel_name || cam;
  if (subCam) subParts.push('Khu vực: ' + subCam);
  if (a.ipc_addr) subParts.push('IP: ' + a.ipc_addr);
  el.querySelector('.tl-sub').textContent = subParts.join(' · ') || '—';

  // Thẻ chi tiết thực tế từ API (chỉ thêm khi dữ liệu thật tồn tại)
  const detBox = el.querySelector('.tl-det-box');

  if (Array.isArray(a.capture_info) && a.capture_info.length > 0) {
    const detCap = document.createElement('span');
    detCap.className = 'tl-det-item';
    detCap.textContent = ` ${a.capture_info.length} đối tượng phát hiện`;
    detBox.append(detCap);
  }

  if (a.area_num != null) {
    const detArea = document.createElement('span');
    detArea.className = 'tl-det-item';
    detArea.textContent = `${a.area_num} người trong vùng`;
    detBox.append(detArea);
  }

  // 4. Cụm thao tác nhanh (Quick Actions) - Luôn hiển thị tất cả các nút (Hàng 1: Ảnh gốc + Clip, Hàng 2: Mở camera)
  const acts = el.querySelector('.tl-acts');
  acts.innerHTML = '';

  const rowTop = document.createElement('div');
  rowTop.className = 'tl-acts-row';

  // Nút 1: Xem ảnh gốc
  const btnImg = document.createElement('button');
  btnImg.className = 'tl-act-btn';
  btnImg.textContent = 'Ảnh gốc';
  btnImg.title = img ? 'Xem ảnh chụp chất lượng cao' : 'Không có ảnh chụp';
  if (!img) btnImg.style.opacity = '0.65';
  btnImg.onclick = e => {
    e.stopPropagation();
    if (img) {
      window.open(img, '_blank');
    } else {
      toast({
        sev: 'ẢNH GỐC', kind: 'warn',
        title: 'Cảnh báo này không có ảnh chụp đính kèm từ AI Box'
      });
    }
  };
  rowTop.append(btnImg);

  // Nút 2: Xem clip
  const vidUrl = videoOf(a);
  const btnClip = document.createElement('button');
  btnClip.className = 'tl-act-btn';
  btnClip.textContent = 'Xem clip';
  btnClip.title = vidUrl ? 'Phát đoạn clip ngắn sự kiện' : 'Không có video clip';
  if (!vidUrl) btnClip.style.opacity = '0.65';
  btnClip.onclick = e => {
    e.stopPropagation();
    if (vidUrl) {
      openVideo(a);
    } else {
      toast({
        sev: 'CLIP SỰ KIỆN', kind: 'warn',
        title: 'AI Box chưa lưu hoặc đã xoá đoạn clip của cảnh báo này'
      });
    }
  };
  rowTop.append(btnClip);

  acts.append(rowTop);

  // Nút 3: Mở camera (Hàng 2)
  const btnCam = document.createElement('button');
  btnCam.className = 'tl-act-btn btn-cam';
  btnCam.textContent = 'Mở camera →';
  btnCam.title = cam ? 'Xem trực tiếp camera' : 'Không có thông tin camera';
  if (!cam) btnCam.style.opacity = '0.65';
  btnCam.onclick = e => {
    e.stopPropagation();
    if (cam) {
      openDetail(cam);
    } else {
      toast({
        sev: 'CAMERA', kind: 'warn',
        title: 'Không xác định được kênh camera của cảnh báo này'
      });
    }
  };
  acts.append(btnCam);

  // Người được nhận diện khuôn mặt (Mặc định hiển thị khung nhận diện)
  const per = a.person;
  const isRecognized = per && (per.name || per.image);
  const phHTML = '<span class="ph-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;display:block"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span><span class="ph-tx">Chưa nhận diện</span>';

  const pb = document.createElement('div');
  pb.className = 'tl-per' + (isRecognized ? ' has-per' : '');

  if (per && per.image) {
    const im = document.createElement('img');
    im.alt = 'Ảnh người được nhận diện';
    im.loading = 'lazy';
    im.onerror = () => {
      const ph = document.createElement('div');
      ph.className = 'tl-per-ph';
      ph.innerHTML = phHTML;
      im.replaceWith(ph);
    };
    const pi = per.image;
    im.src = new URL(BASE + (pi.startsWith('/') ? pi.slice(1) : 'alarms/' + pi), location.href).href;
    pb.append(im);
  } else {
    const ph = document.createElement('div');
    ph.className = 'tl-per-ph';
    ph.innerHTML = phHTML;
    pb.append(ph);
  }

  const txt = document.createElement('div');
  txt.className = 'tl-per-txt';

  const nm = document.createElement('div');
  nm.className = 'tl-per-nm';
  nm.textContent = isRecognized ? (per.name || 'Người lạ') : 'Không nhận diện được';
  if (!isRecognized) nm.style.color = 'rgba(255,255,255,0.45)';
  txt.append(nm);

  const sc = document.createElement('div');
  sc.className = 'tl-per-sc';
  if (per && per.similarity != null) {
    sc.textContent = 'Độ chính xác ' + per.similarity + '%';
  } else {
    sc.style.color = 'rgba(255,255,255,0.3)';
    sc.style.fontSize = '10px';
    sc.textContent = 'Chưa có thông tin';
  }
  txt.append(sc);

  // Nút xem chi tiết người được nhận diện
  const btnPer = document.createElement('button');
  btnPer.className = 'tl-per-btn';
  btnPer.textContent = 'Chi tiết →';
  btnPer.title = isRecognized ? 'Xem chi tiết thông tin đối tượng nhận diện' : 'Không có thông tin nhận diện';
  if (!isRecognized) btnPer.style.opacity = '0.5';
  btnPer.onclick = e => {
    e.stopPropagation();
    if (isRecognized) {
      openPersonDetail(per, a);
    } else {
      toast({
        sev: 'NHẬN DIỆN', kind: 'warn',
        title: 'Sự kiện này chưa nhận diện được thông tin nhân sự'
      });
    }
  };
  txt.append(btnPer);

  if (isRecognized) {
    pb.title = 'Bấm để xem chi tiết đối tượng nhận diện';
    pb.onclick = e => {
      e.stopPropagation();
      openPersonDetail(per, a);
    };
  }

  pb.append(txt);
  el.querySelector('.tl-mn').after(pb);
  if (videoOf(a)) {
    const p = document.createElement('div');
    p.className = 'tl-play';
    p.innerHTML = '<span>&#9654;</span>';
    el.querySelector('.tl-th').append(p);
  }
  return el;
}

$('#logRefresh').onclick = loadLog;

/* ================= xem lai clip ================= */

// Clip chieu tren CHINH khung stage cua trang chi tiet, khong phai modal rieng.
// Box cat clip theo khoang thoi gian, KHONG luu san file -> moi lan mo la 1 request
// GET vao box (~1.4 MB, 3s).
let vod = null;                  // {el, msg} khi dang xem lai, null khi dang live

function openVideo(a) {
  const url = videoOf(a);
  if (!url) return;
  const cam = camOf(a);
  // Clip chieu tren stage cua detail -> phai dang o detay dung camera do truoc
  if (S.view !== 'detail' || S.focus !== cam) {
    if (!cam || !S.api[cam]) return toast({
      sev: 'KHÔNG CÓ LUỒNG', kind: 'warn',
      title: 'Camera này không có luồng trên go2rtc nên không mở được khung xem lại'});
    openDetail(cam);
  }
  stopVideo();                   // dang xem clip khac -> thay bang clip nay
  detachDetailPlayer();          // thao player live, GIU S.focus

  const stage = $('#stage');
  const el = document.createElement('video');
  el.className = 'vod-v';
  el.controls = true;
  el.autoplay = true;
  el.playsInline = true;
  const msg = document.createElement('div');
  msg.className = 'vod-msg';
  msg.textContent = 'Đang tải clip từ AI box…';
  // Chen vao DOM va gan handler TRUOC khi gan src, keo bi race
  stage.prepend(el, msg);
  el.onloadeddata = () => msg.remove();
  el.onerror = () => {
    msg.className = 'vod-msg err';
    msg.textContent = 'Không tải được clip. Box chỉ giữ video trong thời gian ngắn — '
      + 'cảnh báo cũ có thể đã bị xoá khỏi bộ nhớ box.';
  };
  el.src = url;
  vod = {el, msg};

  // Nut LIVE xam + bam duoc de ve luong truc tiep
  const live = $('#dLive');
  // Bo 'wait' (mo .35 khi luong chua len hinh) thay vi chong lai no bang opacity
  // inline — nut nay dang la nut bam duoc, khong duoc mo.
  live.classList.remove('wait');
  live.classList.add('back');
  live.title = 'Bấm để trở về luồng trực tiếp';
  // Giu nguyen chu LIVE khi xem lai: gio cua clip da hien o thanh lich su va #dQual,
  // doi nhan thanh "XEM LAI <gio>" chi lam badge dai ra va lap thong tin.
  $('#dQual').textContent = algoName(a.algo_model, a.algo_name) || a.label || 'Clip phát hiện';
  paintHistory();                // danh dau clip dang mo trong thanh lich su
}

/** Bo clip, tra khung stage ve luong truc tiep. */
function stopVideo() {
  if (!vod) return;
  vod.el.pause();
  vod.el.removeAttribute('src');   // huy request dang tai, khong keo tiep nen
  vod.el.load();
  vod.el.remove();
  vod.msg.remove();
  vod = null;
  const live = $('#dLive');
  live.classList.remove('back');
  live.title = '';
  live.lastChild.textContent = 'LIVE';
}

function backToLive() {
  const name = S.focus;
  stopVideo();
  if (name) openDetail(name);      // dung lai player live tu dau
}

$('#dLive').onclick = () => { if (vod) backToLive(); };

/* ================= trang thai box tren header ================= */

let boxName = '';
function boxDot(txt, col, pulse) {
  $('#cBox').textContent = txt;
  $('#cBox').style.color = col;
  const d = $('#dBox');
  d.style.background = col;
  d.style.animation = pulse ? 'omPulse 2s ease-in-out infinite' : 'none';
}

let boxBusy = false;
async function checkBox() {
  if (boxBusy) return;
  boxBusy = true;
  try {
    let d;
    try {
      const j = await (await fetch(BASE + 'api/conn',
        {signal: AbortSignal.timeout(6000)})).json();
      d = j.data || {};
    } catch {
      return boxDot('AI BOX MẤT KẾT NỐI', 'var(--err2)');   // aibox.py chua chay
    }
    if (!d.host) return boxDot('AI BOX CHƯA CẤU HÌNH', 'var(--warn)');
    if (!d.has_pass) return boxDot('AI BOX THIẾU MẬT KHẨU', 'var(--warn)');
    boxDot('AI BOX ĐANG THỬ…', 'var(--dim)');
    const r = await fetch(BASE + 'api/conn/test', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.code === 0) {
      boxName = (j.data || {}).device_name || (j.data || {}).model || d.host;
      boxDot('AI BOX ' + boxName, 'var(--ok)', true);
    } else {
      // code 3 = sai user/pass, 1000-1004 = loi dang nhap, -1 = khong toi duoc box
      boxDot('AI BOX LỖI ' + j.code, 'var(--err2)');
    }
  } catch {
    boxDot('AI BOX KHÔNG PHẢN HỒI', 'var(--err2)');
  } finally {
    boxBusy = false;
  }
}

/* ================= canh bao: popup + vien nhay + lich su ================= */

let unread = 0;
const bumpUnread = () => {
  updateUnreadBadge();
  setTimeout(() => {
    const bell = $('#notifBellBtn');
    if (bell) {
      bell.classList.add('bell-ring');
      setTimeout(() => bell.classList.remove('bell-ring'), 1500);
    }
  }, 1000);
};

startAlarms(ev => {
  if (ev.kind === 'sse' || !isDetect(ev)) {
    markTiles();
    updateUnreadBadge();
    return;
  }
  // Đánh dấu thẻ vừa tới là MỚI -> thẻ trong tab Nhật ký hiện badge "MỚI".
  if (ev.event_id != null) { FRESH.add(ev.event_id); if (FRESH.size > 200) FRESH.clear(); }
  const cam = camOf(ev);
  markTiles();
  if (S.view === 'log') loadLog();            // KHÔNG reset unread — số giữ đến khi bấm "Đã xem"
  else bumpUnread();
  if (S.view === 'live' || (S.view === 'detail' && S.focus === cam)) paintHistory();
}, name => {                                    // clearAlarm -> ve lai ngay
  markTiles();
  updateUnreadBadge();
  if (S.view === 'log') loadLog();              // nút "Bỏ qua" trên thẻ biến mất
  if (S.view === 'live' || (S.view === 'detail' && S.focus === name)) paintHistory();
  paintRail();
});

// Backup Real-time Polling: Tự động kiểm tra cảnh báo mới từ server mỗi 4 giây
setInterval(async () => {
  try {
    const added = await loadAlarmHistory();
    if (added > 0) {
      updateUnreadBadge();
      markTiles();
      if (S.view === 'log') paintAlarms();
      if (S.view === 'live' || (S.view === 'detail')) paintHistory();
    }
  } catch { /* network silent fallback */ }
}, 4000);

/** Vien nhay do tren tile dang canh bao (chi hien khi co canh bao CHUA DOC). */
function markTiles() {
  for (const [name, t] of S.tiles) {
    const unreadCamCount = alarms().filter(a => isDetect(a) && camOf(a) === name && !SEEN.has(notifKey(a))).length;
    const isUnread = unreadCamCount > 0;
    t.box.classList.toggle('detect', isUnread);
    let b = t.box.querySelector('.t-ai');
    if (!isUnread) { b?.remove(); continue; }
    if (!b) {
      b = document.createElement('span');
      b.className = 'badge off t-ai';
      t.box.querySelector('.t-top').insertBefore(b, t.ar);
    }
    b.textContent = '⚠ ' + unreadCamCount;
  }
  paintAreaBadge();
  paintRail();
}

/** Số người trong vùng (AreaRuleData) real-time: badge riêng NGAY TRÁI LIVE, không phải
 *  cảnh báo. Camera có bật thuật toán thì badge LUÔN hiện — chưa có số thì hiện '—', có
 *  số thì hiện SỐ CUỐI CÙNG (kể cả đã cũ; box không đẩy đều, đo thật ch7 im tới 975s).
 *  `|| areaCount` là đường lùi: không đọc được /api/cameras (bridge tắt, xem từ máy khác)
 *  thì vẫn hiện theo dữ liệu như trước. Badge nằm sẵn trong template nên không còn
 *  createElement/append/remove. Chạy từ markTiles (mỗi SSE) và từ refresh() (3s). */
function paintAreaBadge() {
  for (const [name, t] of S.tiles) {
    // Chưa có số (mới refresh) thì hiện 0, không hiện '—': box đẩy cả 0 nên '0 người'
    // là trạng thái thật. Chỉ ẩn khi camera không bật thuật toán lẫn chưa từng có số.
    const c = areaCount(name);
    t.ar.hidden = !(areaOn(name) || c);
    t.ar.textContent = '👥 ' + (c?.n ?? 0);
  }
}

/** Ve MOT thanh lich su: wrap=khung .hist-list, nEl=dong dem, ackEl=nut bo qua (null neu khong co). */
export function paintHistBar(wrap, nEl, ackEl, list, active, emptyMsg) {
  if (!wrap) return;
  nEl.textContent = list.length ? list.length + ' cảnh báo' : 'chưa có cảnh báo';
  if (ackEl) ackEl.hidden = !active;
  if (!list.length) {
    wrap.innerHTML = '<span class="h-none"></span>';
    wrap.firstChild.textContent = emptyMsg;
    return;
  }
  wrap.replaceChildren(...list.slice(0, 40).map(x => {
    const el = document.createElement('div');
    el.className = 'h-item';
    el.innerHTML = '<div class="h-noimg">không ảnh</div>' +
      '<div class="h-meta"><span class="h-algo"></span><span class="h-time"></span></div>';
    el.querySelector('.h-algo').textContent = algoName(x.algo_model, x.algo_name) || x.label;
    el.querySelector('.h-time').textContent = hms(new Date((x.ts || 0) * 1000));
    const img = imgOf(x);
    if (img) {
      const im = document.createElement('img');
      im.alt = 'Ảnh phát hiện ' + (algoName(x.algo_model) || '');
      im.loading = 'lazy';
      el.firstElementChild.replaceWith(im);
      im.onerror = () => im.replaceWith(Object.assign(document.createElement('div'),
        {className: 'h-noimg', textContent: 'ảnh lỗi'}));
      im.src = img;
    }
    // Chi mot phan alarm co clip -> chi bay nut play khi that su co
    if (videoOf(x)) {
      const pl = document.createElement('div');
      pl.className = 'h-play';
      pl.innerHTML = '<span>&#9654;</span>';
      el.append(pl);
      el.title = 'Bấm để xem lại clip';
      el.onclick = () => openVideo(x);
    } else {
      el.title = 'Cảnh báo này không có clip';
    }
    return el;
  }));
}

/** Thanh lich su o detail (camera dang focus) + thanh toan box o man Live (#hist2). */
export function paintHistory() {
  const name = S.focus;
  paintHistBar($('#hist'), $('#histN'), null,
    name ? alarmsOf(name) : [], name ? activeAlarm(name) : null,
    'Chưa có cảnh báo nào từ AI box cho camera này');
  paintHistBar($('#hist2'), $('#histN2'), null,
    alarms().filter(isDetect), null,
    'Chưa có cảnh báo nào từ AI box');
  // Man Live: so = so canh bao MOI (unread) giong badge nhat ky, khong phai tong 300.
  $('#histN2').textContent = unread ? unread + ' cảnh báo mới' : 'chưa có cảnh báo mới';
}

/** Rail trai man Live: danh sach camera cuon doc. Giu lai card cu (RAIL) va chi cap
 *  nhat field doi de khong mat hover moi lan ve. Card dung chinh class .trow cua
 *  bang camera (id | ten | trang thai) cho hieu ung va ngoai hinh giong nhau. */
const RAIL = new Map();
const CAMN = new Map();          // stream -> ten camera (tu /api/cameras)
async function seedCamNames() {
  try {
    const j = await cameraList();
    if (j.code === 0) for (const c of j.data || []) CAMN.set(c.stream, c.name || c.stream);
  } catch (e) { /* khe */ }
  paintRail();
}
function railCard(nm) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'trow rail-row';
  el.innerHTML = '<span class="c-id"></span>' +
    '<div class="rail-b"><span class="c-nm"></span></div>' +
    '<span class="rail-al"></span>' +
    '<span class="rail-ms"></span>' +
    '<span class="c-st"><span class="dot"></span><span class="s"></span></span>';
  el.querySelector('.c-id').textContent = nm;
  el.onclick = () => openDetail(nm);
  RAIL.set(nm, el);
  return el;
}
function paintRail() {
  const wrap = $('#rail');
  if (!wrap) return;
  const names = S.order || [];
  $('#railN').textContent = names.length + ' camera';
  for (const [nm, el] of [...RAIL]) if (!names.includes(nm)) { el.remove(); RAIL.delete(nm); }
  names.forEach((nm, i) => {
    const el = RAIL.get(nm) || railCard(nm);
    if (wrap.children[i] !== el) wrap.insertBefore(el, wrap.children[i] || null);
    const st = statusOf(nm);
    const unreadCamCount = alarms().filter(a => isDetect(a) && camOf(a) === nm && !SEEN.has(notifKey(a))).length;
    el.classList.toggle('off', st.cls === 'off');
    el.classList.toggle('wait', st.cls === 'wait');
    el.classList.toggle('al', unreadCamCount > 0);
    el.querySelector('.c-nm').textContent = CAMN.get(nm) || nm;
    // Badge số người trong vùng: đặt BÊN TRÁI nút LIVE, cùng màu tím như trên tile.
    const ms = el.querySelector('.rail-ms');
    const ac = areaCount(nm);
    // Đồng bộ với tile (paintAreaBadge): chưa có số thì hiện 0, không hiện '—'.
    if (areaOn(nm) || ac) { ms.hidden = false; ms.textContent = '👥 ' + (ac ? ac.n : 0); }
    else ms.hidden = true;
    // Badge số cảnh báo: chỉ hiển thị khi có cảnh báo CHƯA ĐỌC
    const al = el.querySelector('.rail-al');
    if (unreadCamCount > 0) { al.hidden = false; al.textContent = '⚠ ' + unreadCamCount; }
    else al.hidden = true;
    const sEl = el.querySelector('.c-st');
    // Chi hien pill trang thai khi LIVE / OFFLINE — khong hien "TAM DUNG"/"DANG KET NOI".
    sEl.hidden = st.cls === 'wait';
    sEl.classList.toggle('off', st.cls === 'off');
    sEl.querySelector('.s').textContent = st.txt;
  });
}

// Lan chuot tren thanh lich su -> truot ngang (thanh nay cao 150px, khong scroll doc).
// passive:false vi co preventDefault. Chi chan khi con cho truot theo huong do, khong
// thi cuon den dau thanh lai chan luon scroll cua trang.
const histWheel = e => {
  const el = e.currentTarget, max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  const d = e.deltaY || e.deltaX;
  if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
  e.preventDefault();
  el.scrollLeft += d;
};
for (const hid of ['#hist', '#hist2'])
  $(hid).addEventListener('wheel', histWheel, {passive: false});

/* ================= tab Cau hinh: ket noi box ================= */

const cnState = (txt, col) => {
  $('#cnState').textContent = txt;
  $('#cnState').style.color = col || '';
};

async function cnLoad() {
  try {
    const j = await (await fetch(BASE + 'api/conn')).json();
    const d = j.data || {};
    $('#cnHost').value = d.host || '';
    $('#cnPort').value = d.port || 80;
    $('#cnUser').value = d.user || 'admin';
    cnState(d.host ? 'Đã lưu · ' + d.host + ':' + d.port : 'Chưa cấu hình',
            d.host ? 'var(--ok)' : 'var(--warn)');
    // Telegram — dong chip "Đã cấu hình · N nhóm" tren card
    tgSel = new Set(d.tg_chats || []);
    renderTgGroups();
    tgState(d.has_tg ? 'Đã cấu hình · ' + tgSel.size + ' nhóm' : 'Chưa cấu hình',
            d.has_tg ? 'var(--ok)' : '');
  } catch {
    cnState('Không đọc được cấu hình (aibox.py chưa chạy?)', 'var(--err2)');
  }
}

const cnPost = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(25000),
  });
  return r.json();
};

/* Select "Đăng ký alarm" (Platform 1|2) — nút giả + panel menu glass, cao = ô điền bên cạnh. */
let dkSlot = 1;
const dkSlotClose = () => {
  const m = $('#dkSlotMenu');
  m.hidden = true;
  $('#dkSlotBtn').setAttribute('aria-expanded', 'false');
};
const dkSlotOpen = () => {
  // Panel FIXED top-level (dat cuoi body, khoi .card/.nosb) -> khong bi stacking-context
  // cua card che. Dat ngay duoi nut bang getBoundingClientRect (nhu #tgPanel).
  const btn = $('#dkSlotBtn'), m = $('#dkSlotMenu');
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  m.style.left = r.left + 'px';
  m.style.width = r.width + 'px';
  m.style.top = (r.bottom + 8 + m.offsetHeight > innerHeight - 8
    ? r.top - m.offsetHeight - 8 : r.bottom + 8) + 'px';
  $('#dkSlotBtn').setAttribute('aria-expanded', 'true');
};
const dkToggle = e => {
  e && e.stopPropagation();
  const m = $('#dkSlotMenu');
  if (m.hidden) dkSlotOpen(); else dkSlotClose();
};
$('#dkSlotBtn').addEventListener('pointerdown', dkToggle);   // pointerdown: khong bi chan boi click overlay
$('#dkSlotMenu').addEventListener('click', e => {
  const it = e.target.closest('.mrow[data-slot]');
  if (!it) return;
  dkSlot = +it.dataset.slot;
  $('#dkSlotLbl').textContent = 'Platform ' + dkSlot;
  $('#dkSlotMenu').querySelectorAll('.mrow').forEach(x => x.classList.toggle('on', +x.dataset.slot === dkSlot));
  dkSlotClose();
});
document.addEventListener('click', e => {
  if (!e.target.closest('#dkSlotBtn, #dkSlotMenu')) dkSlotClose();
});

$('#cnSave').onclick = async () => {
  cnState('Đang lưu…');
  try {
    const j = await cnPost('api/conn', {
      host: $('#cnHost').value.trim(), port: +$('#cnPort').value || 80,
      user: $('#cnUser').value.trim(), pass: $('#cnPass').value,
      slot: dkSlot,
    });
    if (j.code !== 0) return cnState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
    $('#cnPass').value = '';
    const dk = (j.data || {}).docking || {};
    cnState(dk.ok ? 'Đã lưu · alarm → platform ' + dk.slot : 'Đã lưu · chưa đăng ký alarm',
            dk.ok ? 'var(--ok)' : 'var(--warn)');
    checkBox();
  } catch (e) {
    cnState(e.message, 'var(--err2)');
  }
};

$('#cnTest').onclick = async () => {
  cnState('Đang thử kết nối…');
  try {
    const j = await cnPost('api/conn/test');
    if (j.code !== 0) return cnState('Lỗi ' + j.code + ': ' + (j.msg || ''), 'var(--err2)');
    const d = j.data || {};
    const boxTxt = 'OK · ' + (d.device_name || d.model || '') + ' · SN ' + (d.device_sn || '—');
    // Kiem tra luon platform 1|2 trong box: ai dang giu, slot nao trong. Dong 2.
    try {
      const k = await cnPost('api/conn/docking/info');
      const slots = (k.data || {}).slots || [];
      const who = s => s.enabled ? s.owner : 'trống';
      const txt = slots.map(s => `P${s.slot}: ${who(s)}`).join(' · ');
      cnState(boxTxt + '\nPlatform ' + txt, 'var(--ok)');
    } catch (e) {
      cnState(boxTxt, 'var(--ok)');   // box loi doc docking -> chi dong 1
    }
  } catch (e) {
    cnState(e.message, 'var(--err2)');
  }
};

$('#cnSync').onclick = async () => {
  cnState('Đang đồng bộ camera từ box…');
  try {
    const j = await cnPost('api/sync');
    if (j.code !== 0) return cnState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
    // added/kept/removed là MẢNG tên luồng, không phải số đếm.
    const n = a => (a || []).length;
    cnState(`Đồng bộ xong · thêm ${n(j.added)} · xoá ${n(j.removed)} · giữ ${n(j.kept)}`, 'var(--ok)');
    await refresh();
    // refresh() chỉ vẽ lại lưới go2rtc; bảng Camera đọc /api/cameras nên phải nạp riêng.
    if (S.view === 'cam') loadCams();
  } catch (e) {
    cnState(e.message, 'var(--err2)');
  }
};

/* ---- Telegram: đẩy cảnh báo (ảnh/video + thông tin) vào nhóm ---- */
let tgSel = new Set();          // chat_id da tick (chon de gui)
let tgGroups = [];              // [{id,title,type}] bot tung thay (getUpdates)
const tgState = (txt, col) => {
  const el = $('#tgState');
  el.textContent = txt;
  el.classList.toggle('ok', col === 'var(--ok)');
  el.classList.toggle('err', col === 'var(--warn)' || col === 'var(--err2)');
};

function renderTgGroups() {
  const box = $('#tgGroups');
  const warn = () => {
    if (tgSel.size) return null;
    const w = document.createElement('div');
    w.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:9px 11px;margin:0 0 8px;border-radius:11px;border:1px solid rgba(255,171,64,.45);background:rgba(255,171,64,.10);font:600 11.5px/1.45 var(--b);color:#ffb24d';
    w.textContent = '⚠ Chưa tick nhóm nào — bot SẼ KHÔNG gửi thông báo. Tick ít nhất 1 nhóm bên dưới rồi Lưu.';
    return w;
  };
  // gộp: nhom da quet + chat_id da luu (de tick ke ca nhom chua quet lai duoc)
  const ids = [...new Set([...tgGroups.map(g => g.id), ...tgSel])];
  const byId = Object.fromEntries(tgGroups.map(g => [g.id, g]));
  if (!ids.length) {
    box.textContent = '';
    const w = warn(); if (w) box.appendChild(w);
    const h = document.createElement('span');
    h.className = 'hint';
    h.textContent = 'Chưa thấy nhóm nào — thêm bot vào nhóm Telegram rồi bấm "Quét nhóm" lại.';
    box.appendChild(h);
    return;
  }
  const rows = ids.map(id => {
    const g = byId[id] || {id, title: id, type: ''};
    const on = tgSel.has(id);
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:11px;border:1px solid rgba(255,255,255,.1);cursor:pointer;margin:0 0 6px;background:'
      + (on ? 'rgba(213,194,149,.14)' : 'rgba(255,255,255,.03)') + ';border-color:'
      + (on ? 'rgba(213,194,149,.5)' : 'rgba(255,255,255,.1)') + ';transition:background .18s,border-color .18s';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = on;
    cb.style.cssText = 'width:15px;height:15px;accent-color:var(--gold);flex:none;cursor:pointer';
    const t = document.createElement('span');
    t.style.cssText = 'flex:1;min-width:0;font:600 12.5px/1.2 var(--b);color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    t.textContent = g.title || id;
    const s = document.createElement('span');
    s.style.cssText = 'flex:none;font:400 10px/1 var(--m);color:var(--ghost)';
    s.textContent = (g.type ? g.type + ' · ' : '') + id;
    cb.onchange = () => {
      if (cb.checked) tgSel.add(id); else tgSel.delete(id);
      lab.style.background = cb.checked ? 'rgba(213,194,149,.14)' : 'rgba(255,255,255,.03)';
      lab.style.borderColor = cb.checked ? 'rgba(213,194,149,.5)' : 'rgba(255,255,255,.1)';
      // cap nhat lai canh bao "chua tick" ngay khi thay doi tick
      const old = box.querySelector('.tg-nosel'); if (old) old.remove();
      if (!tgSel.size) { const w = warn(); if (w) { w.classList.add('tg-nosel'); box.prepend(w); } }
    };
    lab.append(cb, t, s);
    return lab;
  });
  const w = warn(); if (w) w.classList.add('tg-nosel');
  box.replaceChildren(...(w ? [w, ...rows] : rows));
}

$('#tgRefresh').onclick = async e => {
  e.stopPropagation();              // khong de document-click dong panel vua mo
  // Panel la FIXED (top-level, khong bi .nosb cat) -> dat ngay duoi nut "Quét nhóm".
  // Mo truoc roi do offsetHeight (cung mot tick, browser chua kip paint nen khong loe),
  // neu khong du cho o duoi thi lat len tren.
  const p = $('#tgPanel');
  p.hidden = false;
  const r = e.currentTarget.getBoundingClientRect();
  p.style.left = Math.min(r.left, innerWidth - 480) + 'px';
  p.style.top = (r.bottom + 8 + p.offsetHeight > innerHeight - 8
    ? r.top - p.offsetHeight - 8 : r.bottom + 8) + 'px';
  tgState('Đang quét nhóm…');
  try {
    const j = await cnPost('api/tg/groups');
    tgGroups = (j.data && j.data.groups) || [];
    if (j.data && j.data.selected) tgSel = new Set(j.data.selected);
    renderTgGroups();
    if (!tgGroups.length) {
      tgState(j.code === 0 ? 'Chưa thấy nhóm nào — thêm bot vào nhóm rồi quét lại' : (j.msg || 'Lỗi'),
              j.code === 0 ? 'var(--warn)' : 'var(--err2)');
    } else {
      tgState('Thấy ' + tgGroups.length + ' nhóm — tick rồi bấm Lưu', 'var(--ok)');
    }
  } catch (e) {
    tgState(e.message, 'var(--err2)');
  }
};

// Click BEN TRONG panel (tick nhom, nut nut) khong duoc dong panel -> chan bong.
$('#tgPanel').onclick = e => e.stopPropagation();
$('#tgClose').onclick = () => { $('#tgPanel').hidden = true; };

// Chat ID thủ công -> van vao danh sach trong panel va duoc tick ngay.
// getUpdates khong thay nhom "im lang" (24h khong ai nhan) -> ID tay la cach duy
// nhat them duoc. Hoi getChat de hien ten that thay vi chuoi so kho doc.
$('#tgAdd').onclick = async () => {
  const v = $('#tgChatManual').value.trim();
  if (!v) return;
  const btn = $('#tgAdd'); btn.disabled = true;
  tgState('Đang lấy thông tin nhóm…');
  try {
    let title = v;
    let cid = v;
    try {
      const j = await cnPost('api/tg/chatname', {id: v});
      if (j.code === 0 && j.data && j.data.title) { title = j.data.title; cid = j.data.id || v; }
      else {
        // getChat that bai => bot KHONG trong nhom / ID sai -> gui sau se 400.
        // Dung lai, bao loi ro thay vi them ID loi roi 400 khi "Gửi thử".
        tgState(j.msg || 'Không lấy được thông tin nhóm — bot chưa trong nhóm hoặc ID sai', 'var(--err2)');
        return;
      }
    } catch (e) { /* loi mang (khong xac minh duoc) -> van cho them */ }
    // Luu id CHUAN (canonical -100...) tu getChat, khong giu id nguoi dung go:
    // go id cu cua supergroup -> HTTP 400 khi gui.
    tgSel.add(cid);
    const g = tgGroups.find(x => x.id === cid);
    if (g) g.title = title; else tgGroups.push({id: cid, title, type: ''});
    $('#tgChatManual').value = '';
    renderTgGroups();
    tgState('Đã thêm nhóm: ' + title, 'var(--ok)');
  } catch (e) {
    tgState(e.message, 'var(--err2)');
  } finally {
    btn.disabled = false;
  }
};

$('#tgSave').onclick = async () => {
  tgState('Đang lưu…');
  try {
    const j = await cnPost('api/conn/tgsave', {
      tg_token: $('#tgToken').value, tg_chats: [...tgSel],
    });
    if (j.code !== 0) return tgState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
    $('#tgToken').value = '';
    const d = j.data || {};
    tgSel = new Set(d.tg_chats || []);
    tgState(d.has_tg ? 'Đã lưu · đẩy tới ' + tgSel.size + ' nhóm' : 'Đã tắt (chưa tick nhóm nào)', 'var(--ok)');
    $('#tgPanel').hidden = true;    // luu xong dong panel chon nhom
  } catch (e) {
    tgState(e.message, 'var(--err2)');
  }
};

$('#tgTest').onclick = async () => {
  if (!tgSel.size) return tgState('Chưa tick nhóm nào', 'var(--warn)');
  tgState('Đang gửi thử…');
  try {
    // luu truoc de backend gui dung danh sach dang tick
    const s = await cnPost('api/conn/tgsave', {tg_token: $('#tgToken').value, tg_chats: [...tgSel]});
    if (s.code !== 0) return tgState(s.msg || 'Lỗi lưu', 'var(--err2)');
    $('#tgToken').value = '';
    const j = await cnPost('api/conn/tgtest');
    if (j.code !== 0) return tgState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
    tgState(j.msg || 'Đã gửi — mở nhóm Telegram để xem', 'var(--ok)');
  } catch (e) {
    tgState(e.message, 'var(--err2)');
  }
};

/* ================= tab Cau hinh: chon 20 thuat toan cho box ================= */

const AL = {sup: [], loaded: [], sel: new Set(), max: 20};

async function loadAlgos() {
  cnLoad();
  const wrap = $('#alCats');
  wrap.innerHTML = '<div class="al-load">Đang đọc thuật toán từ box…</div>';
  try {
    const j = await algoAll();
    if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
    const d = j.data || {};
    AL.sup = d.supported || [];
    AL.loaded = d.loaded || [];
    AL.max = d.max || 20;
    AL.sel = new Set(AL.loaded);
    if (!AL.sup.length) {
      wrap.innerHTML = '<div class="al-load">Box không trả thuật toán nào (/algo/list rỗng)</div>';
      return;
    }
    paintAlgos();
  } catch (e) {
    wrap.innerHTML = '<div class="al-load" style="color:var(--err2)"></div>';
    wrap.firstChild.textContent = 'Không đọc được /algo/list: ' + e.message;
  }
}

function paintAlgos() {
  const n = AL.sel.size, full = n >= AL.max;
  const label = n + '/' + AL.max + ' thuật toán';
  $('#alCnt').textContent = label;
  $('#alCnt2').textContent = label;
  $('#alCnt').className = $('#alCnt2').className = 'al-cnt' + (full ? ' full' : '');
  $('#alBar').style.width = (n / Math.max(1, AL.max) * 100) + '%';
  $('#alHint').textContent = full
    ? 'Đã đạt giới hạn ' + AL.max + ' thuật toán — bỏ bớt trước khi chọn thêm'
    : 'Box giới hạn ' + AL.max + ' thuật toán nạp cùng lúc';

  // Nhom theo Algorithm Function nhu web UI box (algoGroups o ai.js)
  $('#alCats').replaceChildren(...algoGroups(AL.sup).map(g => {
    const cat = document.createElement('div');
    cat.className = 'al-cat';
    cat.innerHTML = '<div class="al-cat-h"><span class="al-cat-n"></span>' +
                    '<span class="al-cat-c"></span></div><div class="al-grid"></div>';
    cat.querySelector('.al-cat-n').textContent = g.cat;
    const chosen = g.models.filter(m => AL.sel.has(m)).length;
    cat.querySelector('.al-cat-c').textContent = chosen + '/' + g.models.length;
    cat.querySelector('.al-grid').replaceChildren(...g.models.map(m => {
      const on = AL.sel.has(m);
      const el = document.createElement('div');
      el.className = 'al-item' + (on ? ' on' : '') + (!on && full ? ' dis' : '');
      el.innerHTML = '<span class="al-box"></span><span class="al-nm"></span>';
      el.querySelector('.al-nm').textContent = algoName(m);
      el.title = m;
      el.onclick = () => {
        if (AL.sel.has(m)) AL.sel.delete(m);
        else if (AL.sel.size >= AL.max) return;
        else AL.sel.add(m);
        paintAlgos();
      };
      return el;
    }));
    return cat;
  }));
}

// Body cua endpoint luu 20 thuat toan chua tim ra (/algo/capabilities tra
// DeviceCapabilities -> la endpoint DOC). Nen mo web box de doi, khong ghi mu.
$('#alSave').onclick = async () => {
  const models = [...AL.sel];
  const btn = $('#alSave'), st = $('#alState');
  if (!models.length) { st.textContent = 'Chưa chọn thuật toán nào'; st.className = 'cn-state err'; return; }
  btn.disabled = true;
  st.className = 'cn-state';
  st.textContent = 'Đang kiểm tra công suất…';
  try {
    // Kiem tra cong suat TRUOC khi ghi: status_code 52040 = khong du cong suat
    const hr = await hashrate(1, models);
    if (hr.status_code === 52040) {
      st.className = 'cn-state err';
      st.textContent = 'Box báo không đủ công suất cho bộ này — bỏ bớt thuật toán';
      return;
    }
    st.textContent = 'Đang nạp vào box…';
    const j = await algoSave(models);
    if (j.code === 0) {
      st.className = 'cn-state ok';
      st.textContent = `Đã nạp ${models.length} thuật toán`;
      toast({kind: 'ok', sev: 'ĐÃ NẠP', title: `Box đã nhận ${models.length} thuật toán`});
      loadAlgos();
      return;
    }
    // Bridge da thu 4 shape body; ca 4 fail -> noi that, kem duong mo web box
    st.className = 'cn-state err';
    st.textContent = j.msg || 'Box từ chối (code ' + j.code + ')';
    console.warn('algo/capabilities đã thử:', j.tried);
    toast({kind: 'warn', sev: 'CHƯA LƯU ĐƯỢC',
      title: 'Box không nhận lệnh nạp thuật toán qua API',
      sub: 'Endpoint có thật nhưng chưa rõ định dạng — bấm "Đổi trên web box" để nạp thủ công'});
  } catch (e) {
    st.className = 'cn-state err';
    st.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
};

$('#alWeb').onclick = async () => {
  const j = await (await fetch(BASE + 'api/conn')).json().catch(() => ({}));
  const host = (j.data || {}).host;
  if (host) window.open('http://' + host + '/#/smart-capabilities/algorithmic-capability', '_blank');
  else toast({sev: 'CHƯA CÓ IP', title: 'Chưa cấu hình IP của box', kind: 'warn'});
};

/* ================= thuat toan cua camera dang mo (sidebar detail) ================= */

async function paintDetailAlgos() {
  const el = $('#dAlgos'), name = S.focus;
  el.innerHTML = row('…', 'đang đọc từ box', 'dim');
  try {
    const j = await cameraList();
    if (name !== S.focus) return;            // user doi camera trong luc cho box
    if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
    const cam = (j.data || []).find(c => c.stream === name);
    if (!cam) { el.innerHTML = row('—', 'không phải channel của AI BOX', 'none'); return; }
    const algos = cam.algos || [];
    el.innerHTML = algos.length
      ? algos.map(m => row(algoName(m), 'đang chạy', 'ok')).join('')
      : row('—', 'chưa bật thuật toán nào', 'none');
  } catch (e) {
    if (name === S.focus) el.innerHTML = row('Lỗi', e.message, 'err');
  }
}

/* ================= THƯ VIỆN (dữ liệu THẬT từ box) =================
   Box CÓ endpoint thư viện nhận diện (dao duoc tu JS vendor): personlib/person
   (khuôn mặt) và workclotheslib/workclothes (đồng phục). Mỗi mục mang image_path
   dang /api/v2/smart/picture?Type=3&Index=... -> đổi sang GET /aibox/picture?...
   thi browser ve duoc anh. KHONG dung lich su canh bao — day la du lieu goc tren
   box. XSS: moi chuoi tu box di qua textContent, khong noi suy innerHTML.

   DELETE khac nhau giua 2 loai: personlib/delete nhan {lib_id:[array]} con
   workclotheslib/delete nhan {lib_id:scalar}. Dung mot ham delLib() de khoi loi. */

const LIB = {face: null, ppe: null, err: '', busy: false};
const LIB_PAGE = 24;
let libTab = 'face';                // 'face' | 'ppe'
let libFilterLib = null;            // null = tat ca, else lib_id (person & workcloth CO THE trung id)
let libFilterKind = null;           // 'face' | 'ppe' - loai cua libFilterLib, de phan biet id trung
let libQ = '';                      // loc theo ten ben client (data da tai het roi)
let libPage = 0;

// Ep chuan: bo dau van hoa truoc khi khop. Go "NGUYEN" van tim ra "Nguyễn".
const norm = t => String(t || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
// row() noi suy value vao innerHTML khong ma hoa (chi dung cho chu so/nghia).
// Moi chuoi tu BOX phai qua escHTML truoc khi vao row() de tranh XSS.
const escHTML = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const libImg = p => {
  const q = String(p || '').split('?')[1];
  return q ? new URL(BASE + 'aibox/picture?' + q, location.href).href : null;
};
const libDate = s => { const d = new Date((s || 0) * 1000);
  return isNaN(d) || !s ? '' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
const libName = x => x.person_name || x.lib_name || ('#' + (x.person_id || x.workclothes_id));
// Box khong co may vi dien tu: dung chu the la khuon mat / bo quan ao.
const MODEL = {0: ['Chưa chạy', 'warn'], 1: ['Chưa chạy', 'warn'], 2: ['Đang chạy', 'warn'],
               3: ['Đã nhận diện', 'ok'], 4: ['Lỗi', 'err']};
const libModel = m => MODEL[m] ? '<span class="lib-ms ' + MODEL[m][1] + '">' + MODEL[m][0] + '</span>' : '';

// personlib khac workclotheslib o khoa danh sach ('list' vs 'workcloth_lib_list'),
// person/list va workclothes/list deu BAT BUOC lib_id -> phai lay tung lib roi moi ket noi.
// Tra ve {libs:[], items:[]}: items la mang phang moi mục, moi mục mang them lib_name.
async function fetchLib(kind) {
  const face = kind === 'face';
  const L = face ? ['personlib', 'person', 'list'] : ['workclotheslib', 'workclothes', 'workcloth_lib_list'];
  const j = await cnPost('aibox/' + L[0] + '/list', {page: 1, pagesize: 200});
  if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
  const libs = ((j.data || {})[L[2]] || []);
  const items = [];
  for (const lb of libs) {
    const it = await cnPost('aibox/' + L[1] + '/list', {page: 1, pagesize: 999, lib_id: lb.lib_id});
    for (const x of ((it.data || {}).list || (it.data || {}).workclothes_list || []))
      items.push(Object.assign({lib_name: lb.lib_name}, x));
  }
  return {libs, items};
}

async function loadLibrary(force) {
  if (LIB.busy) return;
  if ((LIB.face || LIB.ppe) && !force) { paintLibrary(); return; }
  LIB.busy = true; LIB.err = '';
  $('#libRefresh').classList.add('spin');
  paintLibrary();
  try {
    const [face, ppe] = await Promise.all([fetchLib('face'), fetchLib('ppe')]);
    LIB.face = face; LIB.ppe = ppe;
  } catch (e) {
    LIB.err = 'Không đọc được thư viện từ box: ' + e.message;
  } finally {
    LIB.busy = false;
    $('#libRefresh').classList.remove('spin');
    applyDefaultLib();
    paintLibLibMenu();
    paintLibrary();
  }
}

function libCard(x, kind) {
  const el = document.createElement('div');
  el.className = 'lib-card';
  el.innerHTML = '<div class="lib-img"></div><div class="lib-meta">' +
    '<span class="lib-name"></span><span class="lib-sub"></span></div>';
  const img = el.querySelector('.lib-img'), url = libImg(x.image_path);
  if (url) img.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
  // Badge trạng thái model nằm trên ảnh (góc trên phải), không nối vào dòng sub.
  const ms = libModel(x.modeling_type);
  if (ms) img.insertAdjacentHTML('beforeend', ms);
  el.querySelector('.lib-name').textContent = libName(x);
  el.querySelector('.lib-sub').textContent = (kind === 'face'
    ? [x.lib_name, x.tel].filter(Boolean).join(' · ')
    : ['#' + x.workclothes_id, libDate(x.create_time)].filter(Boolean).join(' · '));
  el.title = (kind === 'face' ? 'Nhân sự: ' : 'Đồng phục: ') + libName(x);
  el.onclick = () => openLibDetail(x, kind);
  return el;
}

function libFiltered() {
  let rows = [];
  if (libTab === 'face' && LIB.face) for (const x of LIB.face.items) rows.push([x, 'face']);
  if (libTab === 'ppe' && LIB.ppe) for (const x of LIB.ppe.items) rows.push([x, 'ppe']);
  if (libFilterLib) rows = rows.filter(([x, k]) =>
    x.lib_id === libFilterLib && (!libFilterKind || libFilterKind === k));
  if (libQ) { const q = norm(libQ); rows = rows.filter(([x]) => norm(libName(x)).includes(q)); }
  return rows;
}

function paintLibrary() {
  const grid = $('#libGrid'), empty = $('#libEmpty');
  const rows = libFiltered();
  $('#libCount').textContent = LIB.busy ? 'đang đọc từ box…'
    : LIB.err ? '—'
    : (LIB.face && LIB.ppe) ? rows.length + ' mục' : '—';
  if (LIB.err) {
    grid.innerHTML = ''; empty.hidden = false;
    $('#libEmptyT1').textContent = 'Không đọc được';
    $('#libEmptyT2').textContent = LIB.err;
    return;
  }
  if (LIB.busy && !rows.length) {
    empty.hidden = true;
    grid.innerHTML = '<div class="al-load">Đang đọc thư viện từ box…</div>';
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / LIB_PAGE));
  libPage = Math.min(libPage, pages - 1);
  const shown = rows.slice(libPage * LIB_PAGE, (libPage + 1) * LIB_PAGE);
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    $('#libEmptyT1').textContent = 'Thư viện trống';
    $('#libEmptyT2').textContent = 'Chưa có khuôn nào trong thư viện trên box';
  }
  grid.replaceChildren(...shown.map(([x, k]) => libCard(x, k)));
  const pg = $('#libPager'); pg.hidden = pages <= 1;
  $('#libPgInfo').textContent = rows.length
    ? 'Trang ' + (libPage + 1) + '/' + pages + ' · ' + rows.length + ' mục' : '';
  $('#libPgPrev').classList.toggle('dis', libPage === 0);
  $('#libPgNext').classList.toggle('dis', libPage >= pages - 1);
}

/* ---------------- thanh loc: dropdown thu vien + o tim ---------------- */

// Không còn mục "Tất cả thư viện": luôn hiển thị theo một thư viện cụ thể.
// Mặc định vào thư viện đầu tiên (Default List) của loại đang xem. Chạy một lần
// sau load / đổi tab, KHÔNG chạy trong paintLibrary để tránh tác dụng phụ.
function applyDefaultLib() {
  const libs = (libTab === 'face' ? LIB.face : LIB.ppe)?.libs;
  if (libs && libs.length) { libFilterLib = libs[0].lib_id; libFilterKind = libTab; }
}

function libCurrentKind() {
  if (libFilterKind) return libFilterKind;
  if (libFilterLib) {
    // lib_id co the trung giua 2 loai -> uu tien loai co thu vien do.
    if (LIB.face?.libs.some(l => l.lib_id === libFilterLib)) return 'face';
    if (LIB.ppe?.libs.some(l => l.lib_id === libFilterLib)) return 'ppe';
  }
  return libTab;
}

function paintLibLibMenu() {
  const kind = libCurrentKind();
  const libs = (kind === 'face' ? LIB.face : LIB.ppe)?.libs || [];
  const list = $('#libLibList');
  const mk = (lbl, onclick, noActs) => {
    const b = document.createElement('div');
    b.className = 'mrow';
    b.innerHTML = '<span class="dot"></span><span class="l"></span><span class="k"></span>' +
      '<span class="mi act"></span><span class="mi del"></span>';
    if (noActs) { b.querySelector('.act').remove(); b.querySelector('.del').remove(); }
    b.querySelector('.l').textContent = lbl;
    b.onclick = () => { $('#libLibMenu').hidden = true; onclick(); paintLibLibMenu(); };
    const act = b.querySelector('.act');
    if (act) act.onclick = e => { e.stopPropagation(); $('#libLibMenu').hidden = true;
      const lb = libs.find(l => l.lib_name === lbl); if (lb) openLibNew(kind, lb.lib_id, lb.lib_name); };
    const del = b.querySelector('.del');
    if (del) del.onclick = e => { e.stopPropagation(); $('#libLibMenu').hidden = true;
      const lb = libs.find(l => l.lib_name === lbl); if (lb) delLib(kind, lb); };
    return b;
  };
  list.replaceChildren();
  for (const lb of libs) {
    const b = mk(lb.lib_name, () => { libFilterLib = lb.lib_id; libFilterKind = kind; libPage = 0; paintLibrary(); });
    b.classList.toggle('on', libFilterLib === lb.lib_id && libFilterKind === kind);
    b.querySelector('.dot').style.background = libFilterLib === lb.lib_id && libFilterKind === kind ? 'var(--gold)' : 'rgba(255,255,255,.18)';
    b.querySelector('.act').title = 'Đổi tên';
    b.querySelector('.del').title = 'Xóa thư viện';
    list.append(b);
  }
  const sep = document.createElement('div'); sep.className = 'msep';
  list.append(sep, mk('+ Tạo thư viện mới', () => openLibNew(libCurrentKind(), null, ''), true));
  $('#libLibLbl').textContent = libFilterLib && libFilterKind === kind
    ? (libs.find(l => l.lib_id === libFilterLib)?.lib_name || 'Thư viện')
    : (kind === 'ppe' ? 'Đồng phục' : 'Nhân sự');
}

/* ---------------- tao / doi ten / xoa thu vien ---------------- */
// LN.id null = tao, so = doi ten thu vien do cua LN.kind.
const LN = {id: null, kind: 'face', busy: false};

function openLibNew(kind, id, name) {
  LN.id = id; LN.kind = kind;
  $('#libNewTitle').textContent = id ? 'Đổi tên thư viện' : 'Tạo thư viện';
  $('#libNewKind').hidden = !!id;              // khong doi loai khi dang doi ten
  $$('#libNewKind button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
  $('#libNewName').value = name || '';
  $('#libNewHint').textContent = id ? 'Tên mới tối đa 64 ký tự' : 'Tối đa 64 ký tự · trùng tên box báo lỗi 400938';
  $('#libNewOk').textContent = id ? 'Lưu' : 'Tạo';
  $('#libNewWrap').hidden = false;
  $('#libNewName').focus();
}

async function saveLib() {
  if (LN.busy) return;
  const name = $('#libNewName').value.trim();
  if (!name) { toast({kind: 'warn', sev: 'CẦN TÊN', title: 'Nhập tên thư viện'}); return; }
  const kind = $$('#libNewKind button.on')[0].dataset.k;
  const pre = kind === 'face' ? 'personlib' : 'workclotheslib';
  LN.busy = true;
  try {
    const body = {lib_name: name};
    if (LN.id) body.lib_id = LN.id;
    const r = await cnPost('aibox/' + pre + (LN.id ? '/update' : '/add'), body);
    if (r.code !== 0) throw new Error(r.msg || 'code ' + r.code);
    $('#libNewWrap').hidden = true;
    toast({kind: 'ok', sev: LN.id ? 'ĐÃ ĐỔI TÊN' : 'ĐÃ TẠO',
           title: LN.id ? 'Đã đổi tên thư viện' : 'Đã tạo thư viện ' + name});
    loadLibrary(true);
  } catch (e) {
    toast({kind: 'warn', sev: 'LỖI', title: 'Không ' + (LN.id ? 'đổi tên' : 'tạo') + ' thư viện',
           sub: e.message});
  } finally { LN.busy = false; }
}

async function delLib(kind, lb) {
  if (!(await confirmBox({
    title: 'Xóa thư viện', yes: 'Xóa',
    msg: 'Xóa thư viện "' + lb.lib_name + '"? Mọi mục bên trong cũng bị xóa.',
    sub: 'Hành động này không thể hoàn tác.',
  }))) return;
  const pre = kind === 'face' ? 'personlib' : 'workclotheslib';
  // personlib/delete nhan ARRAY, workclotheslib/delete nhan SCALAR.
  const body = kind === 'face' ? {lib_id: [lb.lib_id]} : {lib_id: lb.lib_id};
  try {
    const r = await cnPost('aibox/' + pre + '/delete', body);
    if (r.code !== 0) throw new Error(r.msg || 'code ' + r.code);
    if (libFilterLib === lb.lib_id && libFilterKind === kind) { libFilterLib = null; libFilterKind = null; }
    toast({kind: 'ok', sev: 'ĐÃ XÓA', title: 'Đã xóa thư viện ' + lb.lib_name});
    loadLibrary(true);
  } catch (e) {
    toast({kind: 'warn', sev: 'LỖI', title: 'Không xóa được thư viện', sub: e.message});
  }
}

/* ---------------- them mục ---------------- */

const LI = {kind: 'face', file: [], busy: false, thumbs: []};

function paintLi() {
  const isFace = LI.kind === 'face';
  $('#liSub').textContent = isFace
    ? 'POST /api/v2/person/add · ảnh base64 trong JSON'
    : 'POST /api/v2/workclothes/batchadd · tối đa 5 ảnh jpg';
  $('#liNameF').hidden = !isFace;               // workclothes khong co ten
  $('#liFaceF').hidden = !isFace;
  $('#liFileHint').textContent = isFace ? 'JPG/PNG · ≤5MB mỗi ảnh' : 'Chỉ JPG · ≤5MB · tối đa 5 ảnh';
  $('#liFile').accept = isFace ? 'image/jpeg,image/png' : 'image/jpeg';
  $('#liPrev').replaceChildren(...LI.thumbs.map(t => {
    const im = document.createElement('img');
    im.src = t;
    im.onclick = () => { LI.file = LI.file.filter(f => f !== t); paintLi(); };
    return im;
  }));
  $('#liMsg').textContent = LI.busy ? 'Đang gửi lên box…' : '';
}

function openAddItem() {
  LI.kind = libCurrentKind();
  const libs = (LI.kind === 'face' ? LIB.face : LIB.ppe)?.libs || [];
  const sel = $('#liLib');
  sel.replaceChildren(...libs.map(l => {
    const o = document.createElement('option');
    o.value = l.lib_id; o.textContent = l.lib_name;
    return o;
  }));
  const cur = libs.find(l => l.lib_id === libFilterLib && libFilterKind === LI.kind);
  if (cur) sel.value = cur.lib_id;
  LI.file = []; LI.thumbs = [];
  $('#liName').value = ''; $('#liIdNo').value = ''; $('#liTel').value = '';
  $('#liSex').value = '99';
  paintLi();
  $('#liWrap').hidden = false;
  $('#liName').focus();
}

// Doc moi File thanh base64 (bo prefix data-URI) — dung FileReader, nhu vendor lam.
const fileToB64 = f => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(f);
});

async function saveAddItem() {
  if (LI.busy) return;
  const isFace = LI.kind === 'face';
  if (LI.file.length === 0) { toast({kind: 'warn', sev: 'CẦN ẢNH', title: 'Chọn ít nhất một ảnh'}); return; }
  if (isFace && !$('#liName').value.trim()) { toast({kind: 'warn', sev: 'CẦN TÊN', title: 'Nhập tên nhân sự'}); return; }
  const lib_id = +$('#liLib').value;
  let b64;
  try { b64 = await Promise.all(LI.file.map(fileToB64)); }
  catch { toast({kind: 'warn', sev: 'LỖI ẢNH', title: 'Không đọc được ảnh'}); return; }
  LI.busy = true; paintLi();
  try {
    let body;
    if (isFace) {
      body = {
        person_name: $('#liName').value.trim(),
        image_base64: b64[0],
        sex: +$('#liSex').value,
        email: '', tel: $('#liTel').value.trim(),
        certificate_type: 1, certificate_no: $('#liIdNo').value.trim(),
        birth_date: '', lib_id,
      };
    } else {
      body = {lib_id, image_base64: b64};
    }
    const r = await cnPost('aibox/' + (isFace ? 'person/add' : 'workclothes/batchadd'), body);
    if (r.code !== 0) throw new Error(r.msg || 'code ' + r.code);
    $('#liWrap').hidden = true;
    toast({kind: 'ok', sev: 'ĐÃ THÊM', title: 'Đã thêm mục vào thư viện'});
    loadLibrary(true);
  } catch (e) {
    toast({kind: 'warn', sev: 'LỖI', title: 'Không thêm được mục', sub: e.message});
  } finally { LI.busy = false; }
}

/* ---------------- chi tiet + xoa mục ---------------- */

const LD = {x: null, kind: 'face'};

function openPersonDetail(per, a) {
  if (!per) return;
  const pName = per.name || 'Người lạ / Chưa rõ tên';
  $('#ldTitle').textContent = pName;
  $('#ldSub').textContent = 'Nhận diện khuôn mặt · ' + (a && (a.rule_name || a.event_id) ? ('Cảnh báo #' + (a.event_id || '')) : 'Thông tin nhân sự');

  const imgEl = $('#ldImg');
  let url = null;
  if (per.image) {
    url = new URL(BASE + (per.image.startsWith('/') ? per.image.slice(1) : 'alarms/' + per.image), location.href).href;
  } else if (per.image_path) {
    url = libImg(per.image_path);
  }
  imgEl.style.backgroundImage = url ? 'url(' + JSON.stringify(url) + ')' : '';
  imgEl.innerHTML = url ? '' : '<span class="msg">Không có ảnh nhận diện</span>';

  const rows = [];
  rows.push(row('Tên nhân sự', escHTML(pName)));
  if (per.similarity != null) rows.push(row('Độ chính xác', per.similarity + '%'));
  if (per.person_id) rows.push(row('Mã nhân sự', escHTML('#' + per.person_id), 'dim'));
  if (per.lib_name) rows.push(row('Thư viện', escHTML(per.lib_name)));
  if (per.sex != null && per.sex !== 99) rows.push(row('Giới tính', per.sex === 1 ? 'Nam' : 'Nữ'));
  if (per.tel) rows.push(row('Điện thoại', escHTML(per.tel)));
  if (per.email) rows.push(row('Email', escHTML(per.email)));
  if (per.certificate_no) rows.push(row('Số giấy tờ', escHTML(per.certificate_no)));

  if (a) {
    const cName = a.channel_name || (a.channel_id ? ('Kênh ' + a.channel_id) : '');
    if (cName) rows.push(row('Kênh Camera', escHTML(cName)));
    if (a.ts) {
      const d = new Date(a.ts * 1000);
      if (!isNaN(d.getTime())) rows.push(row('Thời gian phát hiện', d.toLocaleString('vi-VN')));
    }
  }

  $('#ldFields').innerHTML = rows.join('');
  if ($('#ldDel')) $('#ldDel').hidden = true;
  $('#ldWrap').hidden = false;
}

function openLibDetail(x, kind) {
  LD.x = x; LD.kind = kind;
  if ($('#ldDel')) $('#ldDel').hidden = false;
  $('#ldTitle').textContent = libName(x);
  $('#ldSub').textContent = (kind === 'face' ? 'Nhân sự' : 'Đồng phục')
    + ' · ' + x.lib_name + ' · ' + libDate(x.create_time || 0);
  const img = $('#ldImg');
  const url = libImg(x.image_path);
  img.style.backgroundImage = url ? 'url(' + JSON.stringify(url) + ')' : '';
  img.innerHTML = url ? '' : '<span class="msg">Không có ảnh</span>';
  const rows = [];
  if (kind === 'face') {
    rows.push(
      row('Tên', escHTML(x.person_name) || '—'),
      row('Mã', escHTML('#' + x.person_id), 'dim'),
      row('Giới tính', x.sex == null || x.sex === 99 ? '—' : (x.sex === 1 ? 'Nam' : 'Nữ')),
      row('Điện thoại', escHTML(x.tel) || '—'),
      row('Email', escHTML(x.email) || '—'),
      row('Số giấy tờ', escHTML(x.certificate_no) || '—'),
    );
  } else {
    rows.push(
      row('Thư viện', escHTML(x.lib_name) || '—'),
      row('Mã', escHTML('#' + x.workclothes_id), 'dim'),
      row('Ngày thêm', escHTML(libDate(x.create_time)) || '—'),
    );
  }
  const st = libModel(x.modeling_type);
  if (st) rows.push(row('Trạng thái', st, ''));
  $('#ldFields').innerHTML = rows.join('');
  $('#ldWrap').hidden = false;
}

async function delLibItem() {
  const x = LD.x;
  if (!x || !(await confirmBox({
    title: 'Xóa mục', yes: 'Xóa',
    msg: 'Xóa "' + libName(x) + '" khỏi thư viện ' + x.lib_name + '?',
    sub: 'Hành động này không thể hoàn tác.',
  }))) return;
  const isFace = LD.kind === 'face';
  const body = isFace ? {person_id_list: [x.person_id]} : {lib_id: x.lib_id, workclothes_id_list: [x.workclothes_id]};
  try {
    const r = await cnPost('aibox/' + (isFace ? 'person/delete' : 'workclothes/delete'), body);
    if (r.code !== 0) throw new Error(r.msg || 'code ' + r.code);
    $('#ldWrap').hidden = true;
    toast({kind: 'ok', sev: 'ĐÃ XÓA', title: 'Đã xóa mục ' + libName(x)});
    loadLibrary(true);
  } catch (e) {
    toast({kind: 'warn', sev: 'LỖI', title: 'Không xóa được mục', sub: e.message});
  }
}

/* ================= VI / EN =================
   Đúng phạm vi I18N của design gốc: bản .dc.html cũng chỉ dịch nhãn dock + tiêu
   đề view + vài nhãn tĩnh, còn mọi chuỗi động trong ui.js/ai.js vẫn tiếng Việt. */
const I18N = {
  vi: {tLive:'Camera trực tiếp', tLog:'Nhật ký sự kiện AI', tLib:'Thư viện nhận diện',
       tCams:'Danh sách camera', tCfg:'Cấu hình hệ thống', tAI:'Cấu hình AI',
       allCams:'Tất cả camera', reload:'Tải lại luồng', refresh:'Làm mới',
       dock0:'Live', dock1:'Nhật ký', dock2:'Thư viện', dock3:'Camera', dock4:'Cấu hình',
       langTitle:'Đổi ngôn ngữ', libFace:'Nhân sự', libPpe:'Đồng phục'},
  en: {tLive:'Live cameras', tLog:'AI event log', tLib:'Recognition library',
       tCams:'Camera list', tCfg:'System settings', tAI:'AI configuration',
       allCams:'All cameras', reload:'Reload stream', refresh:'Refresh',
       dock0:'Live', dock1:'Logs', dock2:'Library', dock3:'Cameras', dock4:'Settings',
       langTitle:'Switch language', libFace:'Staff', libPpe:'Uniforms'},
};
let LANG = 'vi';
try { LANG = localStorage.getItem('vb-lang') === 'en' ? 'en' : 'vi'; } catch { /* private mode */ }
function applyI18n() {
  const t = I18N[LANG] || I18N.vi;
  $$('[data-i18n]').forEach(el => { const v = t[el.dataset.i18n]; if (v) el.textContent = v; });
  $$('[data-i18n-title]').forEach(el => { const v = t[el.dataset.i18nTitle]; if (v) el.title = v; });
  const ls = $('#langSwitch');
  if (ls) ls.dataset.lang = LANG;
  document.documentElement.lang = LANG;
}

/* ================= vong lap + khoi dong ================= */

$('#camReload').onclick = loadCams;
$('#libRefresh').onclick = () => loadLibrary(true);
// Làm mới cũng phải dựng lại menu thư viện (mới tạo/xóa -> danh sách lib đổi).
loadLibrary = ((f) => async function (force) { const r = await f(force); paintLibLibMenu(); return r; })(loadLibrary);
$$('#libTabs button').forEach(b => b.onclick = () => {
  libTab = b.dataset.lib; libFilterLib = null; libFilterKind = null; libPage = 0;
  applyDefaultLib();
  $$('#libTabs button').forEach(x => x.classList.toggle('on', x === b));
  paintLibLibMenu(); paintLibrary();
});
$('#libQ').oninput = e => { libQ = e.target.value.trim(); libPage = 0; paintLibrary(); };
$('#libPgPrev').onclick = () => { if (libPage > 0) { libPage--; paintLibrary(); } };
$('#libPgNext').onclick = () => { const rows = libFiltered();
  if (libPage < Math.ceil(rows.length / LIB_PAGE) - 1) { libPage++; paintLibrary(); } };
$('#libLibBtn').onclick = e => { e.stopPropagation(); paintLibLibMenu();
  const m = $('#libLibMenu'); m.hidden = !m.hidden;
  $('#libLibBtn').setAttribute('aria-expanded', String(!m.hidden)); };
$('#libAdd').onclick = () => openAddItem();
// Nút "Thêm mục" trong mọi modal phải focus về đúng tab, và Enter trong ô tên cũng gửi.
$('#libNewOk').onclick = saveLib; $('#libNewNo').onclick = () => $('#libNewWrap').hidden = true;
$('#libNewX').onclick = () => $('#libNewWrap').hidden = true;
$('#libNewWrap').onclick = e => { if (e.target === $('#libNewWrap')) $('#libNewWrap').hidden = true; };
$('#libNewName').addEventListener('keydown', e => { if (e.key === 'Enter') saveLib(); });
$$('#libNewKind button').forEach(b => b.onclick = () => {
  $$('#libNewKind button').forEach(x => x.classList.toggle('on', x === b));
});
$('#liOk').onclick = saveAddItem; $('#liNo').onclick = () => $('#liWrap').hidden = true;
$('#liX').onclick = () => $('#liWrap').hidden = true;
$('#liWrap').onclick = e => { if (e.target === $('#liWrap')) $('#liWrap').hidden = true; };
$$('#liKind button').forEach(b => b.onclick = () => {
  $$('#liKind button').forEach(x => x.classList.toggle('on', x === b));
  LI.kind = b.dataset.k; paintLi();
});
$('#liFile').onchange = () => {
  // LI.file giu FILE (de sau FileReader doc thanh base64), thumbs giu blob URL de hien thi.
  const max = LI.kind === 'face' ? 1 : 5;
  const files = [...$('#liFile').files].slice(0, max);
  $('#liFile').value = '';
  LI.file = []; LI.thumbs = [];
  files.forEach(f => { LI.file.push(f); LI.thumbs.push(URL.createObjectURL(f)); });
  paintLi();
};
$('#ldNo').onclick = () => $('#ldWrap').hidden = true;
$('#ldX').onclick = () => $('#ldWrap').hidden = true;
$('#ldWrap').onclick = e => { if (e.target === $('#ldWrap')) $('#ldWrap').hidden = true; };
$('#ldDel').onclick = delLibItem;
// Đóng menu thư viện khi bấm ra ngoài.
document.addEventListener('click', e => {
  if (!$('#libLibMenu').hidden && !e.target.closest('#libLibDrop')) $('#libLibMenu').hidden = true;
});
// Bấm thumb (không có data-l) = đổi ngôn ngữ; bấm VI/EN = chọn thẳng.
$('#langSwitch').onclick = e => {
  const o = e.target.closest && e.target.closest('[data-l]');
  LANG = o ? (o.dataset.l === 'en' ? 'en' : 'vi') : (LANG === 'vi' ? 'en' : 'vi');
  try { localStorage.setItem('vb-lang', LANG); } catch { /* private mode */ }
  applyI18n();
};
applyI18n();
// Roi panel = BO vung dang ve (chua luu) va tra mode ve idle. Khong lam thi lan
// sau vao lai van con moc cu, va con tro van la dau cong.
$('#aiBack').onclick = () => { exitDraw(); go('cam'); };
$('#aiCancel').onclick = () => { exitDraw(); go('cam'); };

// Vao tab nao thi nap tab do — khong poll box lien tuc
hooks.onView = view => {
  if (view !== 'ai') exitDraw();          // doi view bang duong nao cung bo vung chua luu
  // go('live') chạy lúc boot (cuối file) và mỗi lần quay lại tab Live -> đọc cấu hình ở
  // đây là đủ, không cần timer riêng: bật AreaRuleData trong panel AI rồi về Live là
  // badge hiện ngay. KHÔNG cho vào tick 1s / refresh 3s — box có giới hạn đăng nhập.
  if (view === 'live') { loadAreaOn().then(paintAreaBadge); seedCamNames(); paintHistory(); }
  if (view === 'detail') { paintHistory(); paintDetailAlgos(); }
  if (view === 'cam') loadCams();
  if (view === 'cfg') loadAlgos();
  if (view === 'log') loadLog();              // số thông báo giữ nguyên tới khi "Đã xem"
  if (view === 'lib') loadLibrary();
};

setNote((m, s) => toast({sev: s === 'warn' ? 'CHÚ Ý' : 'LỖI', title: m,
                         kind: s === 'warn' ? 'warn' : 'err'}));
// ai.js khong import app.js (vong app -> ui -> ai) nen go() phai tiem vao,
// khong thi openAI() chet o `go('ai')` va panel khong bao gio mo.
setGo(go);
initAI();

const tickFps = () => {
  for (const t of S.tiles.values()) sampleFps(t.player);
  if (dPlayer) { sampleFps(dPlayer); sampleRtt(dPlayer); }
  if (S.view === 'detail') paintDetail();
};

tick();
setInterval(tick, 1000);
setInterval(refresh, 3000);
setInterval(tickFps, 1000);
setInterval(checkBox, 30000);
refresh();
checkBox();
go('live');

// Nap lich su canh bao: AL bat dau RONG nen tab Nhat ky trong tron cho den khi
// co canh bao MOI. Ve lai neu dang o tab do luc fetch xong.
loadAlarmHistory()
  .then(n => { if (n && S.view === 'log') loadLog();
               if (n && S.view === 'lib') loadLibrary();
               paintHistory();
               updateUnreadBadge(); })        // ve ca thanh live (#hist2) lan dau sau khi nap
  .catch(e => console.warn('khong nap duoc lich su canh bao:', e.message));
// Seed 'so nguoi trong vung' ngay sau refresh (khong cho box gui event dau tien).
// Loi khong gay: seedAreaCount nuot moi loi, badge chi hien 0 cho den khi box gui.
seedAreaCount();
