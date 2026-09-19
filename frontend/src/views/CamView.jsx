import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {mask, fixPct, nice, G, API} from '../api/client.js';
import {useVideoStream} from '../hooks/useVideoStream.js';
import { useTranslation } from '../i18n/index.jsx';

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
const testUrl = async (src, t) => {
  const tmp = '_probe_' + Date.now();
  try {
    const p = await fetch(API + '?name=' + encodeURIComponent(tmp) +
      '&src=' + encodeURIComponent(src), {method: 'PUT'});
    if (!p.ok) return {err: (await p.text()) || 'PUT ' + p.status, tmp};
    const deadline = Date.now() + 6000;
    let o = null;
    while (Date.now() < deadline) {
      const j = await fetch(API).then(r => r.json());
      o = j[tmp];
      const hasVideo = (o?.producers?.[0]?.medias || []).some(m => m.startsWith('video'));
      if (hasVideo || !o?.producers?.length) break;
      await new Promise(r => setTimeout(r, 400));
    }
    const pr = o?.producers?.[0];
    if (!pr) return {err: t ? t('cam.go2rtcError') : 'go2rtc không mở được luồng', tmp};
    const medias = pr.medias || [];
    const vm = medias.find(m => m.startsWith('video')) || '';
    const codecRaw = (vm.split(',')[2] || '').trim();   // "H264" từ "video, recvonly, H264"
    return {
      tmp,
      codec: codecRaw ? nice(codecRaw.toLowerCase()) : null,
      res: null,
      audio: medias.some(m => m.startsWith('audio'))
    };
  } catch (e) {
    return {err: e.message, tmp};
  }
};

function AddPreview({streamName, msg, onRes}) {
  const wsUrl = streamName ? G + 'api/ws?src=' + encodeURIComponent(streamName) : null;
  const {ref: wrapRef} = useVideoStream(
    wsUrl,
    {mode: 'webrtc,mse', media: 'video', visibilityThreshold: 0.01}
  );
  useEffect(() => {
    if (!streamName || !onRes) return;
    let iv = setInterval(() => {
      const v = wrapRef.current?.querySelector('video');
      if (v && v.videoWidth && v.videoHeight) {
        onRes(v.videoWidth + '×' + v.videoHeight);
        clearInterval(iv);
      }
    }, 300);
    return () => clearInterval(iv);
  }, [streamName, wrapRef, onRes]);
  return (
    <div className="preview" data-roi data-drawing="off" id="mPrev"
      style={{position: 'relative', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#080a0d', border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden'}}>
      {streamName ? (
        <div ref={wrapRef} style={{position: 'absolute', inset: 0}} />
      ) : (
        <span className="msg" id="mPrevMsg" style={{color: 'rgba(245,245,247,.45)', font: '500 12px/1 var(--m)'}}>{msg}</span>
      )}
    </div>
  );
}

const chIdOf = name => {
  const m = /^ch(\d+)$/.exec(name || '');
  return m ? +m[1] : null;
};

// Nối lại URL RTSP với user/pass mới — port mergeRtsp() ai.js:59.
const mergeRtsp = (original, shown, username, password) => {
  const url = (shown || original || '').trim();
  if (!url) return '';
  const m = /^([a-z]+:\/\/)(?:([^:@/]+)(?::([^@/]*))?@)?(.+)$/i.exec(url);
  if (!m) return url;
  const proto = m[1];
  const oldUser = m[2] || '';
  const oldPass = m[3] || '';
  const rest = m[4];
  const u = username != null && username !== '' ? username : oldUser;
  const p = password != null && password !== '' ? password : oldPass;
  if (!u && !p) return proto + rest;
  return proto + u + ':' + p + '@' + rest;
};

const validRtsp = u => /^rtsp:\/\/\S+$/i.test(u);

const SVG_GEAR = 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M19 12a7 7 0 0 0-.1-1.1l1.8-1.4'
  + '-1.8-3.1-2.1.9a7 7 0 0 0-1.8-1.1L14.6 4H9.4l-.4 2.2a7 7 0 0 0-1.8 1.1l-2.1-.9L3.3 9.5l1.8 1.4'
  + 'a7 7 0 0 0 0 2.2l-1.8 1.4 1.8 3.1 2.1-.9a7 7 0 0 0 1.8 1.1L9.4 20h5.2l.4-2.2a7 7 0 0 0 1.8-1.1'
  + 'l2.1.9 1.8-3.1-1.8-1.4A7 7 0 0 0 19 12';
const SVG_PENCIL = 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41'
  + 'l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const SVG_TRASH = 'M5 7h14M9.5 7V4.4h5V7M7 7l1 13h8l1-13M11 10.5v6M13 10.5v6';

/* ============================ component ============================ */

export default function CamView({onOpen, onAi}) {
  const { t } = useTranslation();
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
      setCamErr(t('cam.readCamError') + ': ' + e.message);
    }
  };

  const lastRef = useRef(last);
  lastRef.current = last;
  const bpsRef = useRef(bps);
  bpsRef.current = bps;
  useEffect(() => {
    const poll = async () => {
      try {
        const j = await fetch(G + 'api/streams', {signal: AbortSignal.timeout(6000)}).then(r => r.json());
        const tNow = performance.now();
        const nb = {...bpsRef.current}, nl = {...lastRef.current};
        for (const [name, o] of Object.entries(j)) {
          const rx = (o?.producers?.[0]?.receivers || []).filter(r => r.codec?.codec_type === 'video');
          const bytes = rx.reduce((s, r) => s + (r.bytes || 0), 0);
          const p = nl[name];
          if (p && bytes >= p.bytes && tNow > p.t) nb[name] = (bytes - p.bytes) * 8 / (tNow - p.t) / 1000;
          nl[name] = {bytes, t: tNow};
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
  const discoverRef = useRef(null);

  useEffect(() => {
    if (!discover) return;
    const handleClickOutside = e => {
      if (discoverRef.current && !discoverRef.current.contains(e.target)) {
        setDiscover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [discover]);

  const doScan = async () => {
    if (discover && !discover.busy) {
      setDiscover(null);
      return;
    }
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
    setAddUrl(url); setAddUser(''); setAddPass(''); setAddName(name); setAddCustom('');
    setTest({st: 'idle', rows: null}); setProbeStream(null); setShowAdd(true);
  };

  /* -------- modal thêm camera -------- */
  const [addUrl, setAddUrl] = useState('');
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');
  const [addName, setAddName] = useState('');
  const [addCustom, setAddCustom] = useState('');
  const [media, setMedia] = useState('');
  const [test, setTest] = useState({st: 'idle', rows: null});
  const [probeStream, setProbeStream] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addHint, setAddHint] = useState(t('cam.addDefaultHint'));
  const [testBusy, setTestBusy] = useState(false);

  const closeAddModal = () => {
    if (probeStream) {
      fetch(API + '?src=' + encodeURIComponent(probeStream), {method: 'DELETE'}).catch(() => {});
      setProbeStream(null);
    }
    setShowAdd(false);
  };

  const srcOf = () => {
    const merged = mergeRtsp('', addUrl.trim(), addUser.trim(), addPass);
    const u = fixPct(merged);
    return media === 'video' && !u.includes('#') ? u + '#video' : u;
  };

  const doTest = async () => {
    const finalRtsp = mergeRtsp('', addUrl.trim(), addUser.trim(), addPass);
    if (!validRtsp(finalRtsp)) { setTest({st: 'invalid', rows: null}); setProbeStream(null); return; }
    if (probeStream) {
      fetch(API + '?src=' + encodeURIComponent(probeStream), {method: 'DELETE'}).catch(() => {});
    }
    setTestBusy(true);
    setTest({st: 'testing', rows: null});
    setProbeStream(null);
    const r = await testUrl(srcOf(), t);
    setTest({st: r.err ? 'bad' : 'ok', rows: r});
    if (r.tmp && !r.err) {
      setProbeStream(r.tmp);
    } else {
      setProbeStream(null);
    }
    setTestBusy(false);
  };

  const doAdd = async () => {
    const rawUrl = addUrl.trim();
    const url = mergeRtsp('', rawUrl, addUser.trim(), addPass);
    const name = addName.trim();
    const custom = addCustom.trim();
    if (!validRtsp(url)) { setTest({st: 'invalid', rows: null}); return; }
    if (!name) return alert(t('cam.channelNameRequiredAlert'));
    if (name.length > 64) return alert(t('cam.channelNameMaxAlert'));
    if (url.length > 256) return alert(t('cam.rtspUrlMaxAlert'));
    const hint = addHint;
    setAddHint(t('cam.addingToBox'));
    setAddBusy(true);
    let j;
    try {
      j = await cnPost('channel/add', {
        channel_name: name, rtsp: url, transport_type: 1, custom_code: custom,
      });
    } catch (e) { j = {code: -1, msg: e.message}; }
    finally { setAddBusy(false); setAddHint(hint); }
    if (j.code !== 0) {
      return alert(t('cam.boxRefusedAlert') + ': ' + (j.msg || 'code ' + j.code) +
        (j.step ? `\n(${t('cam.step')} ${j.step})` : '') + (j.hint ? '\n' + j.hint : ''));
    }
    const cid = (j.data || {}).channel_id;
    const stream = cid != null ? 'ch' + cid : null;
    if (stream) fetch(API + '?name=' + encodeURIComponent(stream) +
      '&src=' + encodeURIComponent(srcOf()), {method: 'PUT'}).catch(() => {});
    closeAddModal();
    await load();
  };

  const paintTestMsg = () => {
    if (testBusy) return t('cam.testingConn');
    const m = {
      idle: t('cam.notTestedYet'),
      invalid: t('cam.urlMustStartRtsp'),
      ok: t('cam.connectedOk'),
      bad: t('cam.connectFailed')
    }[test.st];
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
    if (!name) return alert(t('cam.channelNameRequiredAlert'));
    if (name.length > 64) return alert(t('cam.channelNameMaxAlert'));
    if (!/^rtsp:\/\/\S+$/i.test(rtsp)) return alert(t('cam.rtspInvalidAlert'));
    if (rtsp.length > 256) return alert(t('cam.rtspUrlMaxAlert'));
    const hint = eHint;
    setEHint(t('cam.saving'));
    setEBusy(true);
    let j;
    try {
      j = await cnPost('channel/update', {
        channel_id: edit.channel_id, channel_name: name, rtsp,
        transport_type: eForm.transport, custom_code: eForm.custom.trim(),
      });
    } catch (e) { j = {code: -1, msg: e.message}; }
    finally { setEBusy(false); setEHint(hint); }
    if (j.code !== 0) return alert(t('cam.boxRefusedAlert') + ': ' + (j.msg || 'code ' + j.code));
    setShowEdit(false);
    fetch(API + '?name=' + encodeURIComponent(eForm.stream) +
      '&src=' + encodeURIComponent(fixPct(rtsp)), {method: 'PUT'}).catch(() => {});
    await load();
  };

  /* -------- xoá camera -------- */
  const doDelete = async name => {
    const cid = chIdOf(name);
    if (cid == null) return alert(t('cam.notBoxCamAlert', {name}));
    if (!window.confirm(t('cam.confirmDeleteCam', {name}))) return;
    const r = await cnPost('channel/delete', {channel_id_list: [cid]});
    if (r.code !== 0) return alert(r.msg || (t('common.error') + ' ' + r.code));
    fetch(API + '?src=' + encodeURIComponent(name), {method: 'DELETE'}).catch(() => {});
    await load();
  };

  /* -------- trạng thái công suất -------- */
  const hrColor = hr == null ? '' : hr < 20 ? 'var(--err2)' : hr < 50 ? 'var(--warn)' : 'var(--ok)';
  const hrBarCls = hr == null ? '' : hr < 20 ? 'err' : hr < 50 ? 'warn' : '';

  /* -------- render dòng camera -------- */
  const renderRows = () => {
    if (camErr) {
      return <div className="al-load" style={{color: 'var(--err2)'}}>{camErr}</div>;
    }
    if (cams == null) {
      return <div className="al-load">{t('cam.readingCamList')}</div>;
    }
    if (!cams.length) {
      return <div className="al-load">{t('cam.noCamsYet')}</div>;
    }
    return cams.map(c => {
      const nm = c.stream;
      const algoList = c.algos || [];
      const url = mask((streams[nm]?.producers || [])[0]?.url || '—');
      const lat = bps[nm] != null ? bps[nm].toFixed(1) + ' Mbps' : '—';
      return (
        <div className="trow" key={nm} onClick={() => onOpen && onOpen(nm)}>
          <span className="c-id">{nm}</span>
          <div style={{minWidth: 0}}>
            <div className="c-nm">{c.name || '—'}</div>
            <div className="c-algos">{algoList.length ? algoList.length + ' ' + t('cam.algosEnabled') : t('cam.noAlgosEnabled')}</div>
          </div>
          <span className="c-zone">{c.name || '—'}</span>
          <span className="c-ip">{c.ip || '—'}</span>
          <span className="c-url">{url}</span>
          <span className="c-lat">{lat}</span>
          <span className="c-url">{c.rtsp ? mask(c.rtsp) : url}</span>
          <span className="c-lat" style={{textAlign: 'center'}}>{lat}</span>
          <span className={'c-st' + (c.status === 1 ? '' : ' off')}>
            <span className="dot" /><span className="s">{c.status === 1 ? 'ONLINE' : 'OFFLINE'}</span>
          </span>
          <div className="c-act">
            <span className="c-aibtn" data-goldbtn title={t('cam.configAi')}
              onClick={e => { e.stopPropagation(); onAi && onAi(nm); }}>
              <svg viewBox="0 0 24 24"><path d={SVG_GEAR} /></svg>{t('cam.configAi')}
            </span>
            <span className="ico" title={t('cam.editCam')} onClick={e => { e.stopPropagation(); openEdit(c); }}>
              <svg viewBox="0 0 24 24"><path d={SVG_PENCIL} /></svg>
            </span>
            <span className="ico rm" title={t('cam.deleteCam')} onClick={e => { e.stopPropagation(); doDelete(nm); }}>
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
        <span>—</span><span className="dim">{t('cam.noDataYet')}</span>
      </>
    );
    if (r.err) return (
      <>
        <span>{t('common.error')}</span><span className="err">{(String(r.err)).slice(0, 60)}</span>
      </>
    );
    return (
      <>
        <span>Codec</span><span>{r.codec || '—'}</span>
        <span>{t('cam.resolution')}</span><span>{r.res || '—'}</span>
        <span>{t('cam.audioTrack')}</span><span>{r.audio ? t('cam.yes') : t('cam.no')}</span>
      </>
    );
  };

  return (
    <>
      <section className="view" id="v-cam">
        <div className="view-wrap">
          <div className="nosb" style={{flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column'}}>
            <div data-glass className="tbl" style={{borderRadius: 20, flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, position: 'relative'}} ref={discoverRef}>
                <div data-glass className="cap" style={{borderRadius: 14, padding: '9px 14px'}}>
                  <span className="cap-k">{t('cam.remainingPower')}</span>
                  <span className="cap-v" id="camHr" style={hrColor ? {color: hrColor} : undefined}>{hr != null ? hr + '%' : '—'}</span>
                  <div className="cap-bar"><i id="camHrBar" className={hrBarCls} style={{width: (hr == null ? 0 : hr) + '%'}} /></div>
                </div>
                <button data-glassbtn id="discoverBtn" style={{height: 36, padding: '0 15px'}} onClick={doScan}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}><path d="M15 3v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4.5" /><path d="M12 8V4M5 8a7 7 0 1 1-.1 10" /></svg>
                  {t('cam.scanCams')}
                </button>
                <button data-goldbtn id="addBtn" style={{flex: 'none'}} onClick={() => {
                  setAddUrl(''); setAddUser(''); setAddPass(''); setAddName(''); setAddCustom(''); setMedia('');
                  setTest({st: 'idle', rows: null}); setProbeStream(null); setAddHint(t('cam.addDefaultHint')); setShowAdd(true);
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#2a2410" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d="M12 5v14M5 12h14" /></svg>
                  {t('cam.addRtspCam')}
                </button>

                {discover && (
                  <div id="discoverBox" className="discover-box" style={{right: 0}}>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 8px 8px', borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 8}}>
                      <span style={{fontSize: 12, fontWeight: 700, color: '#f5f5f7'}}>{t('cam.lanScanResults')}</span>
                      <button style={{background: 'none', border: 'none', color: 'var(--ghost)', cursor: 'pointer', fontSize: 13, padding: '2px 6px'}} onClick={() => setDiscover(null)}>✕</button>
                    </div>
                    {discover.busy ? (
                      <div className="al-load">{t('cam.scanningLan')}</div>
                    ) : discover.err ? (
                      <div className="al-load" style={{color: 'var(--err2)'}}>{t('cam.cannotScan')}: {discover.err}</div>
                    ) : discover.empty ? (
                      <div className="al-load">{t('cam.noCamsFound')}</div>
                    ) : (
                      discover.devs.map((d, i) => (
                        <div className="d-row" key={i}>
                          <div className="d-main" style={{flex: 1, minWidth: 0}}>
                            <div className="d-l1" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                              <span className="d-ip">{d.addr || d.ip}</span>
                              <span className="d-st" style={{fontSize: 11, color: 'var(--ghost)'}}>{d.manufacturer || '—'}</span>
                            </div>
                            <span className="d-l2" style={{fontSize: 11, color: 'var(--dim)'}}>{(d.manufacturer || '—') + ' · ' + (d.addr || d.ip) + ' · ' + t('cam.notAddedToBox')}</span>
                          </div>
                          <button className="d-add" data-glassbtn style={{height: 28, padding: '0 12px', fontSize: 11}} onClick={() => { setDiscover(null); prefillAdd('rtsp://' + (d.addr || d.ip) + ':554/', d.addr || d.ip); }}>{t('cam.add')}</button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="thead" data-camhead style={{padding: '4px 0 10px', borderBottom: '1px solid var(--bd4)'}}>
                <span>ID</span><span>{t('cam.camName')}</span><span>{t('cam.area')}</span><span>{t('cam.rtspStream')}</span>
                <span style={{textAlign: 'center'}}>{t('cam.latency')}</span><span>{t('cam.status')}</span>
                <span style={{textAlign: 'right'}}>{t('cam.action')}</span>
              </div>
              <div id="camList">{renderRows()}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== MODAL · THÊM CAMERA RTSP ==================== */}
      {showAdd && createPortal((
        <div className="overlay" data-overlay id="modal" style={{position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', overflowY: 'auto'}} onClick={e => { if (e.target === e.currentTarget) closeAddModal(); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(920px, 100%)', borderRadius: 22, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} onClick={e => e.stopPropagation()}>
            <div className="m-head" style={{padding: '18px 22px 14px', borderBottom: '1px solid rgba(255,255,255,.06)', flex: 'none'}}>
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4}}>
                <span className="m-title" style={{fontSize: 17, fontWeight: 700}}>{t('cam.addCamModalTitle')}</span>
                <span className="view-sub" style={{fontSize: 11, color: 'var(--ghost)'}}>POST /api/channel/add · type=2 rtsp · go2rtc đồng bộ theo</span>
              </div>
              <button className="m-x" data-mx id="mClose" aria-label={t('common.close')} onClick={closeAddModal}>✕</button>
            </div>
            <div className="m-body nosb" style={{padding: '20px 22px', gap: 24, display: 'grid', gridTemplateColumns: '1.2fr 1fr', flex: 1, minHeight: 0, overflowY: 'auto'}}>
              <div className="m-col" style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                <div className="field">
                  <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>{t('cam.urlRtspLabel')}</label>
                  <input id="mUrl" className="mono" placeholder="rtsp://192.168.21.178:554/ch01" value={addUrl}
                    onChange={e => { setAddUrl(e.target.value); setTest({st: 'idle', rows: null}); setProbeStream(null); }} />
                  <span className="hint">{t('cam.urlRtspHint')}</span>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
                  <div className="field">
                    <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>USERNAME</label>
                    <input id="mUser" placeholder="admin" value={addUser} onChange={e => setAddUser(e.target.value)} />
                  </div>
                  <div className="field">
                    <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>PASSWORD</label>
                    <input id="mPass" type="password" placeholder={t('cam.passPlaceholder')} value={addPass} onChange={e => setAddPass(e.target.value)} />
                  </div>
                </div>

                <div className="field">
                  <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>{t('cam.channelNameLabel')}</label>
                  <input id="mName" placeholder="cam01" maxLength="64" required value={addName} onChange={e => setAddName(e.target.value)} />
                  <span className="hint">{t('cam.channelNameHint')}</span>
                </div>

                <div className="field">
                  <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>{t('cam.customIdLabel')}</label>
                  <input id="mCustom" placeholder="VD: entrance-cam-01" maxLength="64" value={addCustom} onChange={e => setAddCustom(e.target.value)} />
                  <span className="hint">{t('cam.customIdHint')}</span>
                </div>

                <div className="field">
                  <label style={{fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--ghost)'}}>MEDIA</label>
                  <div data-seg className="seg" id="mMedia" style={{alignSelf: 'flex-start'}}>
                    <button data-media="" className={media === '' ? 'on' : ''} onClick={() => setMedia('')}>{t('cam.mediaBoth')}</button>
                    <button data-media="video" className={media === 'video' ? 'on' : ''} onClick={() => setMedia('video')}>{t('cam.mediaVideoOnly')}</button>
                  </div>
                  <span className="hint">{t('cam.mediaHint')}</span>
                </div>
              </div>

              <div className="m-col" style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                <AddPreview streamName={probeStream} msg={paintTestMsg()}
                      onRes={res => setTest(tState => tState.rows && !tState.rows.err ? {...tState, rows: {...tState.rows, res}} : tState)} />

                <div className="card" data-glass style={{borderRadius: 16, padding: '14px 16px', background: 'rgba(255,255,255,.02)', border: '1px solid var(--bd3)'}}>
                  <div className="card-h" style={{fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'var(--ghost)'}}>{t('cam.testResultsHeader')}</div>
                  <div id="mRows" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, font: '400 12px/1.4 var(--m)', color: 'var(--dim)'}}>
                    {renderTestRows()}
                  </div>
                </div>

                <button data-glassbtn id="mTest" style={{height: 42, justifyContent: 'center', width: '100%', fontSize: 13, fontWeight: 600, borderRadius: 12}} onClick={doTest} disabled={testBusy}>
                  {testBusy ? t('cam.testingConn') : t('cam.testConnBtn')}
                </button>
              </div>
            </div>

            <div className="m-foot" style={{padding: '14px 22px 18px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', flex: 'none'}}>
              <span className="hint" id="mHint" style={{fontSize: 11, color: 'var(--ghost)'}}>{addHint}</span>
              <div className="grow" />
              <button data-glassbtn id="mCancel" style={{height: 38, padding: '0 18px', borderRadius: 10}} onClick={closeAddModal}>{t('common.cancel')}</button>
              <button data-goldbtn id="mAdd" style={{height: 38, padding: '0 20px', borderRadius: 10}} onClick={doAdd} disabled={addBusy}>{t('cam.addToBoxBtn')}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ==================== MODAL · SỬA CAMERA TRÊN BOX ==================== */}
      {showEdit && createPortal((
        <div className="overlay" data-overlay id="editModal" style={{position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', overflowY: 'auto'}} onClick={e => { if (e.target === e.currentTarget) setShowEdit(false); }}>
          <div className="modal" data-modal data-glass style={{width: 'min(620px,100%)', borderRadius: 22}} onClick={e => e.stopPropagation()}>
            <div className="m-head" style={{padding: '18px 22px 14px', borderBottom: '1px solid rgba(255,255,255,.06)'}}>
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4}}>
                <span className="m-title" style={{fontSize: 17, fontWeight: 700}}>{t('cam.editCamModalTitle')} · <span id="eTitle">{eForm.stream + ' · ' + (eForm.name || '—')}</span></span>
                <span className="view-sub" style={{fontSize: 11, color: 'var(--ghost)'}}>{t('cam.editModalSub')}</span>
              </div>
              <button className="m-x" data-mx id="eClose" aria-label={t('common.close')} onClick={() => setShowEdit(false)}>✕</button>
            </div>
            <div className="m-body nosb" style={{padding: '20px 22px'}}>
              <div className="m-col">
                <div className="field"><label>{t('cam.channelNameLabel')}</label>
                  <input id="eName" maxLength="64" required value={eForm.name} onChange={e => setEForm(f => ({...f, name: e.target.value}))} />
                  <span className="hint">{t('lib.max64')}</span></div>
                <div className="field"><label>{t('cam.urlRtspLabel')}</label>
                  <input id="eRtsp" className="mono" spellCheck={false} value={eForm.rtsp} onChange={e => setEForm(f => ({...f, rtsp: e.target.value}))} />
                  <span className="hint">{t('cam.editRtspHint')}</span></div>
                <div className="field"><label>{t('cam.transportProtocolLabel')}</label>
                  <div data-seg className="seg" id="eTransport" style={{alignSelf: 'flex-start'}}>
                    <button data-t="1" className={eForm.transport === 1 ? 'on' : ''} onClick={() => setEForm(f => ({...f, transport: 1}))}>TCP</button>
                    <button data-t="2" className={eForm.transport === 2 ? 'on' : ''} onClick={() => setEForm(f => ({...f, transport: 2}))}>UDP</button>
                  </div></div>
              </div>
              <div className="m-col">
                <div className="field"><label>USERNAME</label>
                  <input id="eUser" placeholder="admin" value={eForm.user} onChange={e => setEForm(f => ({...f, user: e.target.value}))} /></div>
                <div className="field"><label>PASSWORD</label>
                  <input id="ePass" type="password" placeholder={t('cam.passPlaceholder')} value={eForm.pass} onChange={e => setEForm(f => ({...f, pass: e.target.value}))} />
                  <span className="hint">{t('cam.editPassHint')}</span></div>
                <div className="field"><label>{t('cam.customIdLabel')}</label>
                  <input id="eCustom" maxLength="64" placeholder="tùy chọn" value={eForm.custom} onChange={e => setEForm(f => ({...f, custom: e.target.value}))} />
                  <span className="hint">{t('cam.editCustomHint')}</span></div>
              </div>
            </div>
            <div className="m-foot" style={{padding: '14px 22px 18px', borderTop: '1px solid rgba(255,255,255,.06)'}}>
              <span className="hint" id="eHint">{eHint}</span>
              <div className="grow" />
              <button data-glassbtn id="eCancel" style={{height: 38, padding: '0 18px', borderRadius: 10}} onClick={() => setShowEdit(false)}>{t('common.cancel')}</button>
              <button data-goldbtn id="eSave" style={{height: 38, padding: '0 20px', borderRadius: 10}} onClick={doSave} disabled={eBusy}>{t('cam.saveChanges')}</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}