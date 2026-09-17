import React, {useEffect, useMemo, useRef, useState, useCallback} from 'react';
import {G, BASE, API, jget, post, hms, imgOf} from '../api/client.js';
import useEvents from '../api/useEvents.js';
import {useVideoStream} from '../hooks/useVideoStream.js';

/**
 * LiveView — port of #v-live trong index.html (118-197) + app.js drawGrid/
 * pollStreams (72-226) + ui.js railCard/paintRail/seedCamNames (1252-1311) +
 * paintHistory() cho #hist2 (1235-1245) + menu lọc/bố cục (ui.js 373-431).
 *
 * Dùng useState/useEffect thay cho DOM manipulation trực tiếp. Giữ NGUYÊN cấu trúc
 * markup, id/class và mọi nhãn tiếng Việt từ bản gốc để CSS (style.css đã copy) áp
 * đúng. Mỗi ô lưới = <Tile> (bọc useVideoStream), render trạng thái LIVE/
 * OFFLINE/ĐANG KẾT NỐI như paintTile/statusOf.
 *
 * Luồng dữ liệu:
 *  - Poll go2rtc /api/streams mỗi 3s (pollStreams) -> S.order (tên luồng ch1..chN)
 *  - GET /api/cameras (POST) -> tên camera (seedCamNames) + thuật toán bật (areaOn)
 *  - SSE /events (useEvents) -> alarm (nhật ký #hist2) + đếm người trong vùng
 *  - Lọc (Tất cả / Đang phát / Có lỗi), bố cục (2x2/3x3/4x4), phân trang như bản gốc.
 */

const FILTERS = [
  {k: 'all',  l: 'Tất cả',    dot: 'var(--cy)'},
  {k: 'live', l: 'Đang phát', dot: 'var(--ok)'},
  {k: 'down', l: 'Có lỗi',    dot: 'var(--err)'},
];

const LAYOUTS = [[2, '2×2'], [3, '3×3'], [4, '4×4']];

// tên thuật toán -> tiếng Việt (giữ đúng tên từ ai.js ALGO_VI đã port).
const algoName = (m, fromBox) => fromBox || m || 'Cảnh báo';

// 1 alarm có phải phát hiện thật không (port isDetect — type 2/6/7 không phải).
const isDetect = a => a != null
  && a.type != null && a.type !== 2 && a.type !== 6 && a.type !== 7
  && a?.kind !== 'sse' && a?.algo_model !== 'AreaRuleData';

// stream go2rtc ứng với 1 alarm (`ch<channel_id>`), null nếu không rõ (port camOf).
const camOf = a => (a?.channel_id != null ? 'ch' + a.channel_id : null);


/**
 * Tile — port của makeTile/paintTile (app.js 137-185). Mỗi ô = 1 <div class="tile">
 * bọc 1 player (useVideoStream quản lý <video> bên trong), + t-top (tên, codec,
 * badge trạng thái + .t-area đếm người), + t-bot (meta + note). Đúng template
 * #t-tile (index.html 1096-1108) và đúng class CSS. State được đẩy lên cha qua
 * onState(name, state, err) để rail trái + lưới đồng bộ như S.tiles gốc.
 */
function Tile({name, displayName, streamUrl, areaOn, areaCount, alarm, onState, onOpen}) {
  const [state, setState] = useState('wait');
  const [err, setErr] = useState(null);
  const [meta, setMeta] = useState(null); // '1080p · 25fps' — set sau frame đầu

  const {ref: wrapRef} = useVideoStream(
    streamUrl,
    {mode: 'webrtc,mse', media: 'video', visibilityThreshold: 0.01},
    d => {
      setState(d.state);
      if (d.error) setErr(d.error);
      if (d.state === 'live') setErr(null);
      // fps / resolution không lấy được trực tiếp qua hook -> dùng meta mặc định.
    },
  );

  // Đồng bộ state lên cha (rail + lưới cùng nhìn).
  const st = state === 'live' ? 'live' : state === 'down' ? 'down' : state === 'pause' ? 'pause' : 'wait';
  useEffect(() => { onState?.(name, st, err); }, [name, st, err, onState]);

  const stx = st === 'live' ? {cls: '', txt: 'LIVE'}
    : st === 'down' ? {cls: 'off', txt: 'OFFLINE'}
    : st === 'pause' ? {cls: 'wait', txt: 'TẠM DỪNG'}
    : {cls: 'wait', txt: 'ĐANG KẾT NỐI'};
  const isDown = st === 'down';
  const showArea = !!(areaOn || areaCount);
  // Camera đang có cảnh báo chưa xem -> viền nháy đỏ + badge alarm (port hiệu
  // ứng cảnh báo người dùng muốn: không chỉ khi down). Dùng chung keyframe
  // omAlertBorder (đỏ nháy) sẵn có.
  const hasAlarm = !!(alarm && alarm.n > 0);

  return (
    <div className={'tile' + (isDown ? ' alert' : '') + (hasAlarm ? ' detect' : '')} data-tile data-rim
         style={{minHeight: 120}} onClick={() => onOpen?.(name)}>
      <span data-edge="top" /><span data-edge="right" /><span data-edge="bottom" /><span data-edge="left" />
      <div ref={wrapRef} style={{position: 'absolute', inset: 0}} />
      <div className="t-top">
        <div className="t-id">
          <div className="t-name">{displayName}</div>
          <div className="t-code" />
        </div>
        {hasAlarm && (
          <span className="badge t-alarm" title={'Cảnh báo: ' + (alarm.algo || '')}
                style={{animation: 'omAlertBorder 1.6s ease-out infinite'}}>
            {'⚠ ' + alarm.n}
          </span>
        )}
        <span className="badge t-area" title="Người trong vùng (real-time)" hidden={!showArea}>
          👥 {(areaCount ? areaCount.n : 0)}
        </span>
        <span className={'badge ' + stx.cls}><span className="t">{stx.txt}</span></span>
      </div>
      <div className="t-bot">
        <span className="t-meta">{meta || '—'}</span>
        <div className="grow" />
        <span className="t-note" style={{color: isDown ? 'var(--err2)' : 'var(--dim)'}}>
          {isDown ? (err ? String(err).slice(0, 42) : 'Mất kết nối')
            : st === 'pause' ? 'ngoài vùng nhìn' : '—'}
        </span>
      </div>
    </div>
  );
}

export default function LiveView({onOpen, onSeen, unread}) {
  // ---------- state tương đương S của app.js ----------
  const [streams, setStreams] = useState({});      // name -> object /api/streams
  const [order, setOrder] = useState([]);          // tên luồng đã sort
  const [bps, setBps] = useState({});              // name -> Mbps (delta bytes)
  const [last, setLast] = useState({});            // name -> {bytes, t}
  const [tiles, setTiles] = useState({});          // name -> {state, err}
  const [camNames, setCamNames] = useState({});    // stream -> tên camera
  const [areaOn, setAreaOn] = useState({});        // stream -> bool (bật AreaRuleData)
  const [areaCount, setAreaCount] = useState({});  // stream -> {n, ts}
  const [activeAlarm, setActiveAlarm] = useState({}); // stream -> {n, ts, algo}
  const [alarms, setAlarms] = useState([]);        // lịch sử cảnh báo (mới nhất trước)

  const [filter, setFilter] = useState('all');
  const [cols, setCols] = useState(3);
  const [page, setPage] = useState(0);

  const [fOpen, setFOpen] = useState(false);       // menu lọc
  const [layoutOpen, setLayoutOpen] = useState(false); // menu bố cục
  const [refreshing, setRefreshing] = useState(false);

  const lastRef = useRef(last);
  lastRef.current = last;
  const bpsRef = useRef(bps);
  bpsRef.current = bps;
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  /* ---------- poll go2rtc (port pollStreams + refresh) ---------- */
  const poll = useCallback(async () => {
    try {
      const j = await jget(API, 6000);
      const t = performance.now();
      const nb = {...bpsRef.current};
      const nl = {...lastRef.current};
      for (const [name, o] of Object.entries(j)) {
        const rx = (o?.producers?.[0]?.receivers || []).filter(r => r.codec?.codec_type === 'video');
        const bytes = rx.reduce((s, r) => s + (r.bytes || 0), 0);
        const p = nl[name];
        if (p && bytes >= p.bytes && t > p.t) nb[name] = (bytes - p.bytes) * 8 / (t - p.t) / 1000;
        nl[name] = {bytes, t};
      }
      for (const name of Object.keys(bpsRef.current)) if (!(name in j)) delete nb[name];
      setBps(nb);
      setLast(nl);
      setStreams(j);
      setOrder(Object.keys(j).sort());
      return j;
    } catch {
      // go2rtc không phản hồi — giữ lưới cũ.
      return null;
    }
  }, []);

  // auto-poll mỗi 3s + lần đầu.
  useEffect(() => {
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [poll]);

  /* ---------- seed tên camera + thuật toán bật (port seedCamNames + loadAreaOn) ---------- */
  const loadCams = useCallback(async () => {
    try {
      const j = await jget('api/cameras');
      const data = j && (j.data || []);
      if (!Array.isArray(data)) return;
      const nm = {};
      const ar = {};
      for (const c of data) {
        const s = c.stream || ('ch' + c.channel_id);
        nm[s] = c.name || s;
        if ((c.algos || []).includes('AreaRuleData')) ar[s] = true;
      }
      setCamNames(nm);
      setAreaOn(ar);
    } catch { /* khe */ }
  }, []);

  // seed số người trong vùng từ lịch sử (port seedAreaCount).
  const loadAreaCount = useCallback(async () => {
    try {
      const r = await fetch(BASE + 'api/alarms', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({include_area: true}),
      });
      const j = await r.json();
      if (j.code !== 0) return;
      const ac = {};
      for (const a of j.data || []) {
        if (!a._is_area || a.area_num == null) continue;
        const name = camOf(a);
        if (name) ac[name] = {n: a.area_num, ts: Date.now() / 1000};
      }
      setAreaCount(prev => ({...prev, ...ac}));
    } catch { /* khe */ }
  }, []);

  /* ---------- seed lịch sử cảnh báo (#hist2) từ /api/alarms ---------- */
  // Port paintHistory (ui.js 1235): mở view phải thấy alarm cũ, không chỉ alarm
  // realtime kể từ lúc mount. Dedup theo event_id khi ghép vào state (alarm SSE
  // mới hơn ghi đè bản cũ giống isDetect → setAlarms).
  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(BASE + 'api/alarms', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.code !== 0) return;
      const hist = (j.data || []).filter(isDetect);
      if (!hist.length) return;
      setAlarms(prev => {
        const map = new Map();
        for (const a of prev) map.set(a.event_id ?? a, a);
        for (const a of hist) if (a.event_id != null) map.set(a.event_id, a);
        return [...map.values()].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, 300);
      });
      // Badge cảnh báo + viền nháy trên tile phải sống qua refresh: dựng lại từ
      // alarm chưa đọc (alarm.seen do backend ghi) chứ không chỉ đếm SSE từ lúc
      // mount — trước đây refresh xong là badge trắng tới khi có alarm mới.
      // hist đã sắp mới-nhất-trước nên algo giữ được là của cảnh báo mới nhất.
      const act = {};
      for (const a of hist) {
        if (a.seen === true) continue;
        const cam = camOf(a);
        if (!cam) continue;
        const cur = act[cam];
        act[cam] = {
          n: (cur?.n || 0) + 1,
          ts: Math.max(cur?.ts || 0, a.ts || 0),
          algo: cur?.algo || algoName(a.algo_model, a.algo_name) || a.label,
        };
      }
      // prev thắng theo từng camera: alarm SSE vừa tới trong lúc fetch không bị đè.
      // ponytail: seed từ /api/alarms nên trần là 300 dòng route đó trả — quá 300
      // cảnh báo chưa đọc thì tổng badge trên tile sẽ thấp hơn số ở icon Nhật ký.
      // Cần chính xác ở mức đó thì thêm endpoint đếm unread nhóm theo channel_id.
      setActiveAlarm(prev => ({...act, ...prev}));
    } catch { /* khe */ }
  }, []);

  useEffect(() => { loadCams(); loadAreaCount(); loadHistory(); }, [loadCams, loadAreaCount, loadHistory]);

  /* ---------- SSE /events (port startAlarms xử lý bên trong) ---------- */
  useEvents(ev => {
    if (!ev) return;
    if (ev.kind === 'video') return; // clip video phụ — bỏ qua trong lưới
    if (ev.algo_model === 'AreaRuleData') {
      const name = camOf(ev);
      if (name && ev.area_num != null)
        setAreaCount(prev => ({...prev, [name]: {n: ev.area_num, ts: Date.now() / 1000}}));
      return;
    }
    if (!isDetect(ev)) return;
    setAlarms(prev => {
      // dedup theo event_id, giữ bản có nhận diện người (port startAlarms)
      let list = [...prev];
      if (ev.event_id != null) {
        const i = list.findIndex(a => a.event_id === ev.event_id);
        if (i >= 0) {
          const dup = list[i];
          const hasP = a => !!((a?.person || {}).name || (a?.person || {}).similarity != null);
          if (hasP(ev) && !hasP(dup)) list[i] = ev;
          return list; // trùng -> không thêm lại
        }
      }
      list = [ev, ...list].slice(0, 300);
      return list;
    });
    const name = camOf(ev);
    if (name) setActiveAlarm(prev => {
      const cur = prev[name];
      return {...prev, [name]: {n: (cur?.n || 0) + 1, ts: ev.ts, algo: algoName(ev.algo_model, ev.algo_name) || ev.label}};
    });
  }, []);

  /* ---------- trạng thái luồng (port tileState/statusOf/isDown) ---------- */
  const tileState = name => tiles[name]?.state || 'wait';
  const isDown = name => tileState(name) === 'down';
  const statusOf = name => {
    const st = tileState(name);
    if (st === 'live') return {cls: '', txt: 'LIVE'};
    if (st === 'down') return {cls: 'off', txt: 'OFFLINE'};
    if (st === 'pause') return {cls: 'wait', txt: 'TẠM DỪNG'};
    return {cls: 'wait', txt: 'ĐANG KẾT NỐI'};
  };

  const setTileState = useCallback((name, state, err) => {
    setTiles(prev => {
      const cur = prev[name] || {};
      const mapped = {live: 'live', connecting: 'wait', idle: 'pause', retry: 'wait', error: 'down'}[state] || 'wait';
      const next = {...cur, state: mapped};
      if (err) next.err = err;
      if (mapped === 'live') delete next.err;
      if (next.state === cur.state && next.err === cur.err) return prev;
      return {...prev, [name]: next};
    });
  }, []);

  /* ---------- bố cục / lọc / phân trang (port visibleNames) ---------- */
  const {pages, shown} = useMemo(() => {
    const list = order.filter(n =>
      filter === 'live' ? tileState(n) === 'live' :
      filter === 'down' ? isDown(n) : true);
    const size = cols * cols;
    const pgs = Math.max(1, Math.ceil(list.length / size));
    const safe = Math.min(page, pgs - 1);
    if (safe !== page) setPage(safe);
    return {names: list, pages: pgs, size, shown: list.slice(safe * size, safe * size + size)};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, filter, cols, page, tiles, streams]);

  /* ---------- lịch sử cảnh báo (#hist2) ---------- */
  const histList = useMemo(() => alarms.filter(isDetect).slice(0, 40), [alarms]);
  // histN2 hiển thị `unread` prop (số chưa đọc, đồng bộ badge App) — không đếm
  // lại trong hist, để tránh lệch với số trên toàn app.

  /* ---------- menu đóng khi bấm ngoài ---------- */
  useEffect(() => {
    if (!fOpen && !layoutOpen) return undefined;
    const close = () => { setFOpen(false); setLayoutOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [fOpen, layoutOpen]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const t0 = performance.now();
    try {
      await poll();
      await loadCams();
      await loadAreaCount();
      // reset tile trạng thái về connecting để thấy việc refresh (tile tự kết nối lại)
      setTiles(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) =>
        [k, {...v, state: v.state === 'down' ? 'down' : 'wait'}])));
    } finally {
      const rest = 600 - (performance.now() - t0);
      if (rest > 0) await new Promise(r => setTimeout(r, rest));
      setRefreshing(false);
    }
  }, [poll, loadCams, loadAreaCount]);

  const wsUrl = name => new URL(G + 'api/ws?src=' + encodeURIComponent(name),
    (typeof location !== 'undefined' ? location.href : 'http://localhost/')).href;

  /* ---------- render ---------- */
  return (
    <section className="view" id="v-live">
      <div className="view-wrap">
        <div className="live-split">
          <div className="live-cols">
            {/* Rail trái: danh sách camera */}
            <aside className="cam-rail" data-glass>
              <div className="rail-h" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 6, width: '100%'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden'}}>
                  <span className="hist-t" style={{whiteSpace: 'nowrap'}}>Danh sách camera</span>
                  <span className="hist-n" id="railN" style={{whiteSpace: 'nowrap'}}>{order.length}</span>
                </div>

                <div className="tb cam-tb" style={{display: 'flex', alignItems: 'center', gap: 4, margin: 0, padding: 0, border: 'none', background: 'none', flex: 'none'}}>
                  {/* Pager */}
                  <span id="pager" hidden={pages < 2}
                        style={{display: 'flex', alignItems: 'center', gap: 2}}>
                    <button id="pgPrev" data-pgctrl data-pg-dir title="Trang trước"
                            className={page === 0 ? 'dis' : ''}
                            onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
                    <span id="pgNums" style={{display: 'flex', alignItems: 'center', gap: 2}}>
                      {pages > 1 && Array.from({length: pages}, (_, i) => (
                        <button key={i} className={'pg' + (i === page ? ' on' : '')}
                                onClick={() => setPage(i)}>{i + 1}</button>
                      ))}
                    </span>
                    <button id="pgNext" data-pgctrl data-pg-dir title="Trang sau"
                            className={page >= pages - 1 ? 'dis' : ''}
                            onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>›</button>
                    <span className="tb-div" />
                  </span>

                  {/* Bố cục lưới */}
                  <div className="drop" style={{position: 'relative', flex: 'none', display: 'flex'}}>
                    <button data-glassbtn id="layoutBtn"
                            style={{height: 27, padding: '0 9px', borderRadius: 10,
                                    font: '600 11.5px/1 var(--b)',
                                    borderColor: layoutOpen ? 'var(--gold3)' : ''}}
                            onClick={e => { e.stopPropagation(); setLayoutOpen(o => !o); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                           strokeLinecap="round" strokeLinejoin="round" style={{width: 11, height: 11}}>
                        <rect x="3" y="3" width="7" height="7" rx="1.5" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" />
                        <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      </svg>
                      <span id="layoutLabel">{LAYOUTS.find(([c]) => c === cols)?.[1] || '3×3'}</span>
                    </button>
                    <div className="menu" id="layoutMenu" data-glass
                         hidden={!layoutOpen}
                         style={{top: 'calc(100% + 8px)', right: 0, width: 150, borderRadius: 16,
                                 background: 'linear-gradient(180deg, rgba(20, 24, 32, 0.98), rgba(12, 15, 20, 0.98))',
                                 border: '1px solid rgba(255, 255, 255, 0.18)',
                                 boxShadow: '0 16px 34px rgba(0, 0, 0, 0.8)',
                                 backdropFilter: 'blur(20px)',
                                 WebkitBackdropFilter: 'blur(20px)',
                                 zIndex: 100}}>
                      <div id="layoutList">
                        {LAYOUTS.map(([c, l]) => (
                          <div key={c} className={'mrow' + (c === cols ? ' on' : '')}
                               onClick={e => { e.stopPropagation(); setCols(c); setPage(0); setLayoutOpen(false); }}>
                            <span className="l">{l}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <span className="tb-div" />

                  {/* Lọc */}
                  <div className="drop" style={{position: 'relative', flex: 'none', display: 'flex'}}>
                    <button data-goldbtn id="fBtn"
                            style={{height: 27, width: 27, padding: 0, borderRadius: 10,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    borderColor: fOpen ? 'var(--gold3)' : ''}}
                            onClick={e => { e.stopPropagation(); setFOpen(o => !o); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                           strokeLinecap="round" strokeLinejoin="round" style={{width: 11, height: 11}}>
                        <path d="M4 6h16M7 12h10M10 18h4" />
                      </svg>
                    </button>
                    <div className="menu" id="fMenu" data-glass hidden={!fOpen}
                         style={{top: 'calc(100% + 8px)', right: 0, width: 270, borderRadius: 16,
                                 background: 'linear-gradient(180deg, rgba(20, 24, 32, 0.98), rgba(12, 15, 20, 0.98))',
                                 border: '1px solid rgba(255, 255, 255, 0.18)',
                                 boxShadow: '0 16px 34px rgba(0, 0, 0, 0.8)',
                                 backdropFilter: 'blur(20px)',
                                 WebkitBackdropFilter: 'blur(20px)',
                                 zIndex: 100}}>
                      <div id="fList">
                        {FILTERS.map(f => {
                          const n = order.filter(nm =>
                            f.k === 'live' ? tileState(nm) === 'live' :
                            f.k === 'down' ? isDown(nm) : true).length;
                          return (
                            <div key={f.k} className={'mrow' + (f.k === filter ? ' on' : '')}
                                 onClick={e => { e.stopPropagation(); setFilter(f.k); setPage(0); setFOpen(false); }}>
                              <span className="dot" style={{background: f.dot}} />
                              <span className="l">{f.l}</span>
                              <span className="k">{n}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rail-list nosb" id="rail">
                {order.length === 0 ? (
                  <div className="al-load">Đang đọc danh sách camera…</div>
                ) : (
                  order.map(nm => {
                    const st = statusOf(nm);
                    const nAl = activeAlarm[nm]?.n || 0;
                    const ac = areaCount[nm];
                    const showMs = (areaOn[nm] || ac);
                    return (
                      <button key={nm} type="button"
                              className={'trow rail-row'
                                + (st.cls === 'off' ? ' off' : '')
                                + (st.cls === 'wait' ? ' wait' : '')
                                + (nAl > 0 ? ' al' : '')}
                              onClick={() => onOpen?.(nm)}>
                        <span className="c-id">{nm}</span>
                        <div className="rail-b"><span className="c-nm">{camNames[nm] || nm}</span></div>
                        <span className="rail-al" hidden={!(nAl > 0)}>⚠ {nAl}</span>
                        <span className="rail-ms" hidden={!showMs}>👥 {(ac ? ac.n : 0)}</span>
                        <span className={'c-st' + (st.cls === 'off' ? ' off' : '')}
                              hidden={st.cls === 'wait'}>
                          <span className="dot" />
                          <span className="s">{st.txt}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <div className="live-main" style={{display: 'flex', flexDirection: 'column'}}>
              {/* Lưới camera */}
              <div id="grid"
                   style={{flex: 1, minHeight: 0, display: 'grid', gap: 12,
                           gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`,
                           gridTemplateRows: `repeat(${cols}, minmax(0,1fr))`}}>
                {shown.length === 0 ? (
                  <div className="empty">
                    <span className="plus">+</span>
                    <span className="t">Không có luồng nào khớp</span>
                  </div>
                ) : (
                  shown.map(nm => (
                    <Tile
                      key={nm}
                      name={nm}
                      displayName={camNames[nm] || nm}
                      streamUrl={wsUrl(nm)}
                      areaOn={areaOn[nm]}
                      areaCount={areaCount[nm]}
                      alarm={activeAlarm[nm]}
                      onState={(n, st, err) => setTileState(n, st, err)}
                      onOpen={onOpen}
                    />
                  ))
                )}
              </div>

              {/* Thanh lịch sử cảnh báo toàn box */}
              <div className="hist-bar" data-glass style={{flex: 'none', marginTop: 8, borderRadius: 18}}>
                <div className="hist-h" style={{flexWrap: 'wrap'}}>
                  <span className="hist-t">Lịch sử cảnh báo</span>
                  <span className="hist-n" id="histN2">
                    {unread ? unread + ' cảnh báo mới' : 'chưa có cảnh báo mới'}
                  </span>
                  <div className="grow" />
                  <span style={{font: '400 10px/1 var(--b)', color: 'rgba(229,229,234,.38)', whiteSpace: 'nowrap'}}>
                    cuộn ngang · bấm để xem lại clip
                  </span>
                </div>
                <div className="hist-list nosb" id="hist2">
                  {histList.length === 0 ? (
                    <span className="h-none">Chưa có cảnh báo nào từ AI box</span>
                  ) : (
                    histList.map((x, i) => {
                      const img = imgOf(x);
                      return (
                        <div key={x.event_id || i} className="h-item" title="Cảnh báo này không có clip"
                             style={{cursor: 'pointer'}}
                             onClick={() => {
                               const n = camOf(x);
                               if (!n) return;
                               onSeen?.(x.event_id);  // ghi seen=true cho đúng cảnh báo này
                               onOpen?.(n);           // mở detail camera của cảnh báo
                             }}>
                          {img ? (
                            <img src={img} alt={'Ảnh phát hiện ' + (algoName(x.algo_model, x.algo_name) || '')}
                                 loading="lazy" onError={e => {
                                   // Box lưu ảnh muộn hơn lúc push alarm -> ảnh mới qua SSE
                                   // load lỗi ngay (404). Retry thay src vài lần thay vì vứt
                                   // "ảnh lỗi" vĩnh viễn (phải đổi tab mới có ảnh).
                                   const el = e.currentTarget;
                                   const n = (el.dataset.retry || 0);
                                   if (n >= 3) {
                                     const d = document.createElement('div');
                                     d.className = 'h-noimg'; d.textContent = 'ảnh lỗi';
                                     el.replaceWith(d);
                                     return;
                                   }
                                   el.dataset.retry = String(+n + 1);
                                   const orig = el.src;
                                   setTimeout(() => { if (el.isConnected) el.src = orig; }, 1500);
                                 }} />
                          ) : (
                            <div className="h-noimg">không ảnh</div>
                          )}
                          {/* Overlay hiện khi hover — dùng .h-play co san (CSS da wire
                              .h-item:hover .h-play). pointer-events:none nen click van
                              roi vao .h-item -> mo camera cua canh bao. */}
                          <div className="h-play"><span>▶</span></div>
                          <div className="h-meta">
                            <span className="h-algo">{algoName(x.algo_model, x.algo_name) || x.label}</span>
                            <span className="h-time">{hms(new Date((x.ts || 0) * 1000))}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}