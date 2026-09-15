/**
 * Chot luat: tile chi hien OFFLINE sau khi da thu lai maxRetry lan.
 * Chay:  node test_video_retry.mjs        (can Node 22.7+)
 *
 * ui/*.js la ES module nhung goc repo khong co package.json, nen Node phai tu
 * nhan dien cu phap (module syntax detection, bat mac dinh tu 22.7). Node cu hon
 * bao "Unexpected token 'export'" -> nang Node, hoac them package.json
 * {"type":"module"} o goc repo.
 *
 * video-stream.js / video-rtc.js la module trinh duyet (extends HTMLElement,
 * customElements.define), nen phai shim globals TRUOC khi import -> dung
 * await import() dong thay vi import tinh (import bi hoist len truoc).
 */

globalThis.HTMLElement = class { };
globalThis.WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o); } };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

let VideoStream = null;
let VideoRTC = null;
globalThis.customElements = { define: (_n, cls) => { VideoStream = cls; } };

({ VideoRTC } = await import('./ui/video-rtc.js'));
await import('./ui/video-stream.js');

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

/** Dung 1 player gia: stubs toi thieu cho oninit() + onclose(). */
function makePlayer() {
    const p = Object.create(VideoStream.prototype);
    p.events = [];
    p.emit = function (s, e) { this.events.push({ s, e }); };
    p.pcState = 'connected';           // !== WebSocket.OPEN -> nhanh retry chay
    p.wsState = WebSocket.OPEN;        // super.onclose() thay != CLOSED -> retry=true
    p.ws = null;
    p.RECONNECT_TIMEOUT = 0;           // retry ngay, khong cho 15s
    p.connectTS = Date.now();
    p.onconnect = () => { };           // chan callback hen gio cua super.onclose()

    // oninit() that, nhung super.oninit() bi stub (no dung DOM that)
    const orig = VideoRTC.prototype.oninit;
    VideoRTC.prototype.oninit = function () { };
    let resizeH = null;
    p.video = { controls: true, videoHeight: 0, currentTime: 0,
                addEventListener: (t, h) => { if (t === 'resize') resizeH = h; } };
    p._armStall = () => { };           // khong phai thu dang test
    VideoStream.prototype.oninit.call(p);
    VideoRTC.prototype.oninit = orig;

    // gia lap "da co hinh": videoHeight > 0 roi ban resize
    p.goLive = () => { p.video.videoHeight = 720; resizeH(); };
    p.closes = () => p.events.filter(e => e.s === 'retry' || e.s === 'error').map(e => e.s);
    return p;
}

// --- 1. maxRetry lan dau: chi 'retry', chua duoc 'error' (chua hien OFFLINE) ---
{
    const p = makePlayer();
    assert(p.maxRetry === 3, 'maxRetry mac dinh phai la 3, dang la ' + p.maxRetry);
    for (let i = 0; i < 3; i++) p.onclose();
    assert(JSON.stringify(p.closes()) === '["retry","retry","retry"]',
        'sau 3 lan dong phai toan retry, dang: ' + JSON.stringify(p.closes()));
}

// --- 2. lan thu 4: moi bat dau 'error' (hien OFFLINE) ---
{
    const p = makePlayer();
    for (let i = 0; i < 4; i++) p.onclose();
    assert(JSON.stringify(p.closes()) === '["retry","retry","retry","error"]',
        'lan thu 4 phai la error, dang: ' + JSON.stringify(p.closes()));
    const err = p.events.find(e => e.s === 'error');
    assert(err.e.error && err.e.error.includes('3'), 'error phai neu ro so lan: ' + JSON.stringify(err.e));
    p.onclose();
    assert(p.closes()[4] === 'error', 'sau khi da error thi van error, khong quay ve retry');
}

// --- 3. co hinh lai -> reset, lan dong ke tiep lai bat dau tu retry ---
{
    const p = makePlayer();
    p.onclose(); p.onclose(); p.onclose();
    p.goLive();                                   // co frame -> chuoi retry ket thuc
    assert(p.events.some(e => e.s === 'live'), 'phai bao live khi co hinh');
    p.onclose();
    assert(p.closes()[3] === 'retry',
        'sau khi live phai reset ve retry, dang: ' + JSON.stringify(p.closes()));
}

// --- 4. maxRetry doi duoc tu ngoai (giong stallTimeout) ---
{
    const p = makePlayer();
    p.maxRetry = 1;
    p.onclose(); p.onclose();
    assert(JSON.stringify(p.closes()) === '["retry","error"]',
        'maxRetry=1 phai la retry roi error, dang: ' + JSON.stringify(p.closes()));
}

// --- 5. teardown co chu y (cuon ra ngoai / doi tab) -> dem lai tu dau ---
{
    const p = makePlayer();
    p.onclose(); p.onclose(); p.onclose();
    assert(p._retries === 3, 'truoc teardown phai dang 3, dang ' + p._retries);
    p.playMode = null;
    p._stallDisarm = () => { };
    const origDisc = VideoRTC.prototype.ondisconnect;
    VideoRTC.prototype.ondisconnect = function () { };   // stub phan dung DOM
    VideoStream.prototype.ondisconnect.call(p);
    VideoRTC.prototype.ondisconnect = origDisc;
    assert(p._retries === 0,
        'ondisconnect phai reset bo dem (khong de ro sang chu ky sau), dang ' + p._retries);
    assert(p.events[p.events.length - 1].s === 'idle',
        'ondisconnect van phai bao idle (khong phai loi)');
}

console.log('video retry selftest ok');
