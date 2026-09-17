import React, {useEffect, useRef, useState} from 'react';
import {mask, fixPct, nice, G} from '../api/client.js';

/**
 * CamView — port of index.html:633-673 (section #v-cam) + the camera table,
 * discover scan, add/edit/delete modals from ui.js (scanNetwork / camRow /
 * openEdit / paintModal / loadCams, 113-224, 433-504, 539-673).
 *
 * Endpoints (relative → dev proxy /api → :8090):
 *   /api/cameras      POST  list of channels (cameraList)
 *   /api/hashrate     POST  remaining box compute power
 *   /api/discover     POST  start LAN scan (+ /api/discover/list to read results)
 *   /api/channel/add|update|delete   POST  manage box channels
 *   /api/sync         POST  re-sync go2rtc streams from box channels
 *
 * MOCK_DATA mode on the backend returns realistic fakes for all of these, so the
 * view renders meaningfully without a real box.
 */

/* ---------- internal helpers (kept local to this view) ---------- */

// POST json tới backend (proxy /api). Trả raw {code,msg?,data?} như cnPost().
const cnPost = async (path, body) => {
  const r = await fetch('/api/' + path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(25000),
  });
  return r.json();
};

// test URL qua go2rtc (chỉ probe: tạo stream tạm rồi xoá) — port testUrl().
// go2rtc API nằm ở :1984 (G), KHÔNG phải đường tương đối /api/streams — đường tương đối
// rơi vào backend :8090 (không có route /api/streams -> 405), làm "Kiểm tra kết nối" luôn fail.
const testUrl = async src => {
  const tmp = '_probe_' + Date.now();
  try {
    const p = await fetch(G + 'api/streams?name=' + encodeURIComponent(tmp) +
      '&src=' + encodeURIComponent(src), {method: 'PUT'});
    if (!p.ok) return {err: (await p.text()) || 'PUT ' + p.status};
    await new Promise(r => setTimeout(r, 1800));
    const j = await fetch(G + 'api/streams').then(r => r.json());
    const o = j[tmp] || {};
    const pr = o.producers?.[0];
    if (!pr) return {err: 'go2rtc không mở được luồng'};
    const rx = (pr.receivers || []).find(x => x.codec?.codec_type === 'video');
    return {codec: rx ? nice(rx.codec.codec_name) : null,
            res: rx?.codec?.width ? rx.codec.width + '×' + rx.codec.height : null,
            audio: (pr.medias || []).some(m => m.startsWith('audio'))};
  } catch (e) {
    return {err: e.message};
  } finally {
    fetch(G + 'api/streams?src=' + encodeURIComponent(tmp), {method: 'DELETE'}).catch(() => {});
  }
};

const chIdOf = name => {
  const m = /^ch(\d+)$/.exec(name || '');
  return m ? +m[1] : null;
};

// Nối lại URL RTSP với user/pass mới — port mergeRtsp() ai.js:59.
const mergeRtsp = (original, shown, username, password) => {
  const old = /^([a-z]+:\/\/)([^:@/]+):([^@/]*)@(.+)$/i.exec(original || '');
  const next = /^([a-z]+:\/\/)(?:[^:@/]+(?::[^@/]*)?@)?(.+)$/i.exec(shown || '');
  if (!old || !next) return original || shown || '';
  return next[1] + (username || old[2]) + ':' + (password || old[3]) + '@' + next[2];
};

const validRtsp = u => /^rtsp:\/\/\S+$/i.test(u);

// Nút "Cấu hình AI" đưa vào dòng camera — bấm vào mở thẳng view AI của camera đó
// (App cấp callback onAi). Bấm "Danh sách camera"/"Hủy" ở view AI quay lại tab này.
const SVG_GEAR = 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19 12a7 7 0 0 0-.1-1.1l1.8-1.4'
  + '-1.8-3.1-2.1.9a7 7 0 0 0-1.8-1.1L14.6 4H9.4l-.4 2.2a7 7 0 0 0-1.8 1.1l-2.1-.9L3.3 9.5l1.8 1.4'
  + 'a7 7 0 0 0 0 2.2l-1.8 1.4 1.8 3.1 2.1-.9a7 7 0 0 0 1.8 1.1L9.4 20h5.2l.4-2.2a7 7 0 0 0 1.8-1.1'
  + 'l2.1.9 1.8-3.1-1.8-1.4A7 7 0 0 0 19 12';
const SVG_PENCIL = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41'
  + 'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const SVG_TRASH = 'M5 7h14M9.5 7V4.4h5V7M7 7l1 13h8l1-13M11 10.5v6M13 10.5v6';

/* ============================ component ============================ */

export default function CamView({onOpen, onAi}) {
  const [cams, setCams] = useState(null);      // null = đang tải; [] = rỗng
  const [camErr, setCamErr] = useState('');
  const [hr, setHr] = useState(null);          // phần trăm công suất còn
  const [discover, setDiscover] = useState(null); // null = đóng; {busy}|{devs}|{err}
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [edit, setEdit] = useState(null);      // đối tượng camera đang sửa
  const [streams, setStreams] = useState({});  // go2rtc /api/streams (c-url, port S.api)
  const [bps, setBps] = useState({});          // stream -> Mbps (c-lat, port S.bps ui.js:532)
  const [last, setLast] = useState({});        // stream -> {bytes, t} cho delta bitrate

  /* -------- tải danh sách camera + công suất -------- */
  const load = async () => {
    setCamErr('');
    try {
      const j = await cnPost('cameras', {});
      if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
      setCams(j.data || []);
      let v = null;
      try {
        const hrJ = await cnPost('hashrate', {channel_id: 1, algo_model: []});
        v = (hrJ.data || {}).hashrate;
      } catch { v = null; }
      setHr(v);
    } catch (e) {
      setCamErr('Không đọc được /api/cameras: ' + e.message);
    }
  };

  // Poll go2rtc :1984 mỗi 3s: c-url (URL thật từ stream) + c-lat (bitrate delta bytes,
  // port pollStreams app.js:77-82 + latOf ui.js:532). URL/bitrate chỉ có khi có receiver
  // đang xem (giống bản gốc) — không xem thì c-url '—', c-lat '—'.
  const lastRef = useRef(last);
  lastRef.current = last;
  const bpsRef = useRef(bps);
  bpsRef.current = bps;
  useEffect(() => {
    const poll = async () => {
      try {
        const j = await fetch(G + 'api/streams', {signal: AbortSignal.timeout(6000)}).then(r => r.json());
        const t = performance.now();
        const nb = {...bpsRef.current}, nl = {...lastRef.current};
        for (const [name, o] of Object.entries(j)) {
          const rx = (o?.producers?.[0]?.receivers || []).filter(r => r.codec?.codec_type === 'video');
          const bytes = rx.reduce((s, r) => s + (r.bytes || 0), 0);
          const p = nl[name];
          if (p && bytes >= p.bytes && t > p.t) nb[name] = (bytes - p.bytes) * 8 / (t - p.t) / 1000;
          nl[name] = {bytes, t};
        }
        for (const name of Object.keys(bpsRef.current)) if (!(name in j)) delete nb[name];
        setBps(nb); setLast(nl); setStreams(j);
      } catch { /* go2rtc im lặng -> giữ cũ */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* -------- quét mạng LAN -------- */
  const doScan = async () => {
    setDiscover({busy: true});
    try {
      const s = await cnPost('discover', {});
      if (s.code !== 0) throw new Error(s.msg || 'code ' + s.code);
      const j = await cnPost('discover/list', {});
      if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
      const devs = j.data || [];
      if (!devs.length) { setDiscover({empty: true}); return; }
      setDiscover({devs});
    } catch (e) {
      setDiscover({err: e.message});
    }
  };

  const prefillAdd = (url, name) => {
    setAddUrl(url); setAddName(name); setTest({st: 'idle', rows: null}); setShowAdd(true);
  };

  /* -------- modal thêm camera -------- */
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [media, setMedia] = useState('');
  const [test, setTest] = useState({st: 'idle', rows: null});
  const [addBusy, setAddBusy] = useState(false);
  const [addHint, setAddHint] = useState('Camera mới hiện ngay trong lưới Live');
  const [testBusy, setTestBusy] = useState(false);

  const srcOf = () => {
    const u = fixPct(addUrl.trim());
    return media === 'video' && !u.includes('#') ? u + '#video' : u;
  };

  const doTest = async () => {
    if (!validRtsp(addUrl.trim())) { setTest({st: 'invalid', rows: null}); return; }
    setTestBusy(true);
    setTest({st: 'testing', rows: null});
    const r = await testUrl(srcOf());
    setTest({st: r.err ? 'bad' : 'ok', rows: r});
    setTestBusy(false);
  };

  const doAdd = async () => {
    const url = addUrl.trim(), name = addName.trim();
    if (!validRtsp(url)) { setTest({st: 'invalid', rows: null}); return; }
    if (!name) return alert('Tên camera: bắt buộc, không được chỉ toàn khoảng trắng');
    if (name.length > 64) return alert('Tên camera: tối đa 64 ký tự');
    if (url.length > 256) return alert('URL RTSP tối đa 256 ký tự (cẩn thận với credential dài)');
    const hint = addHint;
    setAddHint('Đang thêm vào box…');
    setAddBusy(true);
    let j;
    try {
      j = await cnPost('channel/add', {channel_name: name, rtsp: url, transport_type: 1});
    } catch (e) { j = {code: -1, msg: e.message}; }
    finally { setAddBusy(false); setAddHint(hint); }
    if (j.code !== 0) {
      return alert('Box từ chối: ' + (j.msg || 'code ' + j.code) +
        (j.step ? `\n(bước ${j.step})` : '') + (j.hint ? '\n' + j.hint : ''));
    }
    const cid = (j.data || {}).channel_id;
    const stream = cid != null ? 'ch' + cid : null;
    if (stream) fetch(G + 'api/streams?name=' + encodeURIComponent(stream) +
      '&src=' + encodeURIComponent(srcOf()), {method: 'PUT'}).catch(() => {});
    setShowAdd(false);
    await load();
  };

  const paintTestMsg = () => {
    if (testBusy) return 'Đang thử kết nối…';
    const m = {idle: 'Chưa kiểm tra · bấm "Kiểm tra kết nối"', invalid: 'URL phải bắt đầu bằng rtsp://',
               ok: 'Kết nối được', bad: 'Không kết nối được'}[test.st];
    return m;
  };

  /* -------- modal sửa camera -------- */
  const [eForm, setEForm] = useState({name: '', rtsp: '', user: '', pass: '', custom: '', transport: 1, stream: '', originalRtsp: ''});
  const [eBusy, setEBusy] = useState(false);
  const [eHint, setEHint] = useState('');

  const openEdit = c => {
    setEdit(c);
    setEForm({
      name: c.name || '', rtsp: mask(c.rtsp || ''), user: c.username || '', pass: '',
      custom: c.custom_code || '', transport: c.transport_type === 2 ? 2 : 1,
      stream: c.stream, originalRtsp: c.rtsp || '',
    });
    setEHint('');
    setShowEdit(true);
  };

  const doSave = async () => {
    const name = eForm.name.trim();
    const shown = eForm.rtsp.trim();
    const rtsp = mergeRtsp(eForm.originalRtsp, shown, eForm.user.trim(), eForm.pass);
    if (!name) return alert('Channel Name: bắt buộc');
    if (name.length > 64) return alert('Channel Name: tối đa 64 ký tự');
    if (!/^rtsp:\/\/\S+$/i.test(rtsp)) return alert('RTSP URL: không hợp lệ (không tìm thấy mật khẩu cũ?)');
    if (rtsp.length > 256) return alert('RTSP URL: tối đa 256 ký tự');
    const hint = eHint;
    setEHint('Đang lưu…');
    setEBusy(true);
    let j;
    try {
      j = await cnPost('channel/update', {
        channel_id: edit.channel_id, channel_name: name, rtsp,
        transport_type: eForm.transport, custom_code: eForm.custom.trim(),
      });
    } catch (e) { j = {code: -1, msg: e.message}; }
    finally { setEBusy(false); setEHint(hint); }
    if (j.code !== 0) return alert('Box từ chối: ' + (j.msg || 'code ' + j.code));
    setShowEdit(false);
    fetch(G + 'api/streams?name=' + encodeURIComponent(eForm.stream) +
      '&src=' + encodeURIComponent(fixPct(rtsp)), {method: 'PUT'}).catch(() => {});
    await load();
  };

  /* -------- xoá camera -------- */
  const doDelete = async name => {
    const cid = chIdOf(name);
    if (cid == null) return alert('Luồng ' + name + ' không phải camera box (không có channel_id)');
    if (!window.confirm('Xoá camera "' + name + '" khỏi box?')) return;
    const r = await cnPost('channel/delete', {channel_id_list: [cid]});
    if (r.code !== 0) return alert(r.msg || 'Lỗi ' + r.code);
    fetch(G + 'api/streams?src=' + encodeURIComponent(name), {method: 'DELETE'}).catch(() => {});
    await load();
  };

  /* -------- đồng bộ (nút Làm mới bảng) -------- */
  const doReload = async () => { await load(); };

  /* -------- trạng thái công suất -------- */
  const hrColor = hr == null ? '' : hr < 20 ? 'var(--err2)' : hr < 50 ? 'var(--warn)' : 'var(--ok)';
  const hrBarCls = hr == null ? '' : hr < 20 ? 'err' : hr < 50 ? 'warn' : '';

  /* -------- render dòng camera -------- */
  const renderRows = () => {
    if (camErr) {
      return <div className="al-load" style={{color: 'var(--err2)'}}>{camErr}</div>;
    }
    if (cams == null) {
      return <div className="al-load">Đang đọc danh sách camera…</div>;
    }
    if (!cams.length) {
      return <div className="al-load">Chưa có camera nào · bấm "Quét camera" hoặc "Thêm camera RTSP"</div>;
    }
    return cams.map(c => {
      const nm = c.stream;
      const algos = c.algos || [];
      // URL thật từ go2rtc stream (che mật khẩu) — port S.api ui.js:594.
      const url = mask((streams[nm]?.producers || [])[0]?.url || '—');
      // Độ trễ = bitrate Mbps (port latOf ui.js:532): chỉ có khi có receiver đang xem,
      // không có phiên xem thì '—'.
      const lat = bps[nm] != null ? bps[nm].toFixed(1) + ' Mbps' : '—';
      return (
        <div className="trow" key={nm} onClick={() => onOpen && onOpen(nm)}>
          <span className="c-id">{nm}</span>
          <div style={{minWidth: 0}}>
            <div className="c-nm">{c.name || '—'}</div>
            <div className="c-md">{c.model || c.ip || ''}</div>
            <div className="c-algos">{algos.length ? algos.length + ' thuật toán AI' : 'chưa bật AI'}</div>
          </div>
          <span className="c-zone">{c.name || '—'}</span>
          <span className="c-url">{url}</span>
          <span className="c-lat">{lat}</span>
          <span className={'c-st' + (c.status === 1 ? '' : ' off')}>
            <span className="dot" /><span className="s">{c.status === 1 ? 'ONLINE' : 'OFFLINE'}</span>
          </span>
          <div className="c-act">
            <span className="c-aibtn" data-goldbtn title="Cấu hình AI"
              onClick={e => { e.stopPropagation(); onAi && onAi(nm); }}>
              <svg viewBox="0 0 24 24"><path d={SVG_GEAR} /></svg>Cấu hình AI
            </span>
            <span className="ico" title="Chỉnh sửa camera" onClick={e => { e.stopPropagation(); openEdit(c); }}>
              <svg viewBox="0 0 24 24"><path d={SVG_PENCIL} /></svg>
            </span>
            <span className="ico rm" title="Xoá camera" onClick={e => { e.stopPropagation(); doDelete(nm); }}>
              <svg viewBox="0 0 24 24"><path d={SVG_TRASH} /></svg>
            </span>
          </div>
        </div>
      );
    });
  };

  /* -------- modal kết quả kiểm tra -------- */
  const renderTestRows = () => {
    const r = test.rows;
    if (!r) return (
      <>
        <span>—</span><span className="dim">chưa có dữ liệu</span>
      </>
    );
    if (r.err) return (
      <>
        <span>Lỗi</span><span className="err">{(String(r.err)).slice(0, 60)}</span>
      </>
    );
    return (
      <>
        <span>Codec</span><span>{r.codec || '—'}</span>
        <span>Phân giải</span><span>{r.res || '—'}</span>
        <span>Âm thanh</span><span>{r.audio ? 'có' : 'không'}</span>
      </>
    );
  };

  return (
    <>
      <section className="view" id="v-cam">
        <div className="view-wrap">
          <div className="bar" style={{position: 'relative', gap: 12, flexWrap: 'wrap', marginBottom: 16}}>
            <span className="view-h" data-i18n="tCams">Danh sách camera</span>
            <div className="grow" />
            <div className="tb" style={{gap: 8}}>
              <div data-glass className="cap" style={{borderRadius: 14, padding: '9px 14px'}}>
                <span className="cap-k">Công suất còn</span>
                <span className="cap-v" id="camHr" style={hrColor ? {color: hrColor} : undefined}>{hr != null ? hr + '%' : '—'}</span>
                <div className="cap-bar"><i id="camHrBar" className={hrBarCls} style={{width: (hr == null ? 0 : hr) + '%'}} /></div>
              </div>
              <span className="tb-div" />
              <button data-glassbtn id="discoverBtn" style={{height: 36, padding: '0 15px'}} onClick={doScan}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}><path d="M15 3v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4.5" /><path d="M12 8V4M5 8a7 7 0 1 1-.1 10" /></svg>
                Quét camera
              </button>
              <span className="tb-div" />
              <button data-goldbtn id="addBtn" style={{flex: 'none'}} onClick={() => { setAddUrl(''); setAddName(''); setTest({st: 'idle', rows: null}); setAddHint('Camera mới hiện ngay trong lưới Live'); setShowAdd(true); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#2a2410" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d="M12 5v14M5 12h14" /></svg>
                Thêm camera RTSP
              </button>
              <button data-glassbtn id="camReload" style={{height: 36, padding: '0 15px'}} onClick={doReload}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
                <span data-i18n="refresh">Làm mới</span>
              </button>
            </div>

            {discover && (
              <div id="discoverBox" className="discover-box">
                {discover.busy ? (
                  <div className="al-load">Đang quét mạng…</div>
                ) : discover.err ? (
                  <div className="al-load" style={{color: 'var(--err2)'}}>Không quét được: {discover.err}</div>
                ) : discover.empty ? (
                  <div className="al-load">Không tìm thấy camera nào trên mạng</div>
                ) : (
                  discover.devs.map((d, i) => (
                    <div className="d-row" key={i}>
                      <div className="d-main">
                        <div className="d-l1">
                          <span className="d-ip">{d.addr || d.ip}</span>
                          <span className="d-st">{d.manufacturer || '—'}</span>
                        </div>
                        <span className="d-l2">{(d.manufacturer || '—') + ' · ' + (d.addr || d.ip) + ' · chưa thêm vào box'}</span>
                      </div>
                      <button className="d-add" onClick={() => prefillAdd('rtsp://' + d.ip + ':554/', d.ip)}>Thêm</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="nosb" style={{flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column'}}>
            <div data-glass className="tbl" style={{borderRadius: 20, flex: 'none'}}>
              <div className="thead" data-camhead style={{padding: '14px 16px'}}>
                <span>ID</span><span>Tên camera</span><span>Khu vực</span><span>Luồng RTSP</span>
                <span style={{textAlign: 'center'}}>Độ trễ</span><span>Trạng thái</span>
                <span style={{textAlign: 'right'}}>Hành động</span>
              </div>
              <div id="camList">{renderRows()}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== MODAL · THÊM CAMERA RTSP ==================== */}
      {showAdd && (
        <div className="overlay" data-overlay id="modal" onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(900px,100%)'}} onClick={e => e.stopPropagation()}>
            <div className="m-head">
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
                <span className="m-title">Thêm camera vào box</span>
                <span className="view-sub">POST /api/channel/add · type=2 rtsp · go2rtc đồng bộ theo</span>
              </div>
              <button className="m-x" data-mx id="mClose" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div className="m-body nosb">
              <div className="m-col">
                <div className="field"><label>URL RTSP</label>
                  <input id="mUrl" className="mono" placeholder="rtsp://admin:pass@192.168.21.178:554/ch01" value={addUrl}
                    onChange={e => { setAddUrl(e.target.value); setTest({st: 'idle', rows: null}); }} />
                  <span className="hint">Bridge tự escape '%' thành %25 trước khi gửi box (box
                    percent-decode, raw '%' bị từ chối) · riêng go2rtc cũng cần %25.</span></div>
                <div className="field"><label>Tên camera</label>
                  <input id="mName" placeholder="cam01" maxLength="64" required value={addName} onChange={e => setAddName(e.target.value)} />
                  <span className="hint">Thành <code>channel_name</code> trên box: tối đa 64 ký tự,
                    không trùng · tên luồng go2rtc box tự đặt là <code>ch&lt;id&gt;</code></span></div>
                <div className="field"><label>Media</label>
                  <div data-seg className="seg" id="mMedia" style={{alignSelf: 'flex-start'}}>
                    <button data-media="" className={'on' === media ? 'on' : ''} onClick={() => setMedia('')}>Video + âm thanh</button>
                    <button data-media="video" className={media === 'video' ? 'on' : ''} onClick={() => setMedia('video')}>Chỉ video</button>
                  </div>
                  <span className="hint">Chỉ video: bỏ track audio ở luồng go2rtc (box vẫn nhận đủ)</span></div>
              </div>
              <div className="m-col">
                <div className="preview" data-roi data-drawing="off" id="mPrev" style={{aspectRatio: '16/9'}}>
                  <span className="msg" id="mPrevMsg">{paintTestMsg()}</span>
                </div>
                <div className="card" data-glass style={{borderRadius: 16}}>
                  <div className="card-h">Kết quả kiểm tra</div>
                  <div id="mRows" style={{display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, font: '400 11px/1.3 var(--m)', color: 'var(--dim)'}}>{renderTestRows()}</div>
                </div>
                <button data-glassbtn id="mTest" style={{height: 38, justifyContent: 'center'}} onClick={doTest} disabled={testBusy}>Kiểm tra kết nối</button>
              </div>
            </div>
            <div className="m-foot">
              <span className="hint" id="mHint">{addHint}</span>
              <div className="grow" />
              <button data-glassbtn id="mCancel" style={{height: 36, padding: '0 16px'}} onClick={() => setShowAdd(false)}>Hủy</button>
              <button data-goldbtn id="mAdd" style={{height: 36, padding: '0 18px'}} onClick={doAdd} disabled={addBusy}>Thêm vào box</button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL · SỬA CAMERA TRÊN BOX ==================== */}
      {showEdit && (
        <div className="overlay" data-overlay id="editModal" onClick={e => { if (e.target === e.currentTarget) setShowEdit(false); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(620px,100%)'}} onClick={e => e.stopPropagation()}>
            <div className="m-head">
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
                <span className="m-title">Sửa camera · <span id="eTitle">{eForm.stream + ' · ' + (eForm.name || '—')}</span></span>
                <span className="view-sub">POST /api/channel/update · type=2 rtsp · password để trống = giữ nguyên</span>
              </div>
              <button className="m-x" data-mx id="eClose" onClick={() => setShowEdit(false)}>✕</button>
            </div>
            <div className="m-body nosb">
              <div className="m-col">
                <div className="field"><label>Channel Name</label>
                  <input id="eName" maxLength="64" required value={eForm.name} onChange={e => setEForm(f => ({...f, name: e.target.value}))} />
                  <span className="hint">Tối đa 64 ký tự</span></div>
                <div className="field"><label>RTSP URL</label>
                  <input id="eRtsp" className="mono" spellCheck={false} value={eForm.rtsp} onChange={e => setEForm(f => ({...f, rtsp: e.target.value}))} />
                  <span className="hint">Sửa <b>host:port/path</b> tại đây; user:pass nằm ở 2 ô dưới</span></div>
                <div className="field"><label>Transport Protocol</label>
                  <div data-seg className="seg" id="eTransport" style={{alignSelf: 'flex-start'}}>
                    <button data-t="1" className={eForm.transport === 1 ? 'on' : ''} onClick={() => setEForm(f => ({...f, transport: 1}))}>TCP</button>
                    <button data-t="2" className={eForm.transport === 2 ? 'on' : ''} onClick={() => setEForm(f => ({...f, transport: 2}))}>UDP</button>
                  </div></div>
              </div>
              <div className="m-col">
                <div className="field"><label>Username</label>
                  <input id="eUser" placeholder="admin" value={eForm.user} onChange={e => setEForm(f => ({...f, user: e.target.value}))} /></div>
                <div className="field"><label>Password</label>
                  <input id="ePass" type="password" placeholder="để trống = giữ nguyên" value={eForm.pass} onChange={e => setEForm(f => ({...f, pass: e.target.value}))} />
                  <span className="hint">Không hiện mật khẩu cũ; nhập mật khẩu mới thì thay thế</span></div>
                <div className="field"><label>Custom ID</label>
                  <input id="eCustom" maxLength="64" placeholder="tùy chọn" value={eForm.custom} onChange={e => setEForm(f => ({...f, custom: e.target.value}))} />
                  <span className="hint">Mã tùy chỉnh (custom_code) trên box</span></div>
              </div>
            </div>
            <div className="m-foot">
              <span className="hint" id="eHint">{eHint}</span>
              <div className="grow" />
              <button data-glassbtn id="eCancel" style={{height: 36, padding: '0 16px'}} onClick={() => setShowEdit(false)}>Hủy</button>
              <button data-goldbtn id="eSave" style={{height: 36, padding: '0 18px'}} onClick={doSave} disabled={eBusy}>Lưu thay đổi</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}