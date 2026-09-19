import React, {useState, useEffect, useRef, useCallback} from 'react';
import {G, BASE, jget, mask, hms, pad, imgOf, videoOf, evKey, dedupBest} from '../api/client.js';
import {useVideoStream} from '../hooks/useVideoStream.js';
import { useTranslation } from '../i18n/index.jsx';

/* =====================================================================
 * DetailView — port of ui/index.html section #v-detail (lines 199-297)
 * + app.js openDetail/paintDetail/dPlayer (229-305) + ui.js history bar,
 * PTZ joystick (2238-2319) — into a React component.
 *
 * Chỉ dùng đúng class CSS đã có trong src/style.css (.bar .view-h2
 * .view-sub .stage .s-top .s-bot .live .qual .card .card-h .row .rk .rv
 * .hist-bar .hist-t .hist-n .hist-list .h-item .h-meta .h-algo .h-time
 * .ptz .ptz-dial .pz-q .pz-home .ptz-zoom ...) + attribute selector
 * data-glass / data-goldbtn / data-glassbtn / data-split / data-edge.
 * ===================================================================== */

/* ---- Tên thuật toán (port ALGO_VI từ ai.js:80-179, cắt gọn cho các mã
 *      mà mock/box hay trả trong nhật ký). Không nhập từ ai.js (vanilla). */
const ALGO_VI = {
  SafetyHelmetAlarm: 'Không mũ bảo hộ',
  WorkClothesAlarm: 'Không đồng phục',
  TelephoningAlarm: 'Gọi điện thoại',
  SmokingAlarm: 'Hút thuốc',
  SleepingDetectionAlarm: 'Ngủ khi làm việc',
  OffDutyDetectionAlarm: 'Vắng mặt',
  ChannelBlockageDetection: 'Chắn lối thoát hiểm',
  ObjectRemoved: 'Vật để lại',
  FieldDetectorObjectsInside: 'Xâm nhập vùng',
  AccessElevatorAlarm: 'Xe điện vào thang máy',
  NoMaskAlarm: 'Không khẩu trang',
  FallOverAlarm: 'Té ngã',
  CrowdDensityCriticalAlarm: 'Quá đông người',
  ReflectiveClothesDetectionAlarm: 'Không áo phản quang',
  AbnormalParkingDetection: 'Đỗ xe sai / chắn lối chữa cháy',
  FumesAlarmBegin: 'Khói',
  PlayMobilePhoneDetection: 'Dùng điện thoại',
  FireDetection: 'Cháy',
  LongStayDetection: 'Ở lại quá lâu',
  FightDetectionAlarm: 'Đánh nhau',
  LineDetectorCrossed: 'Vượt vạch',
  EnterArea: 'Vào vùng',
  LeaveArea: 'Ra khỏi vùng',
  AreaRuleData: 'Đếm người trong vùng',
  LineRuleData: 'Đếm người qua vạch',
  ObjectIsRecognized: 'Nhận diện mặt',
  NonMotorAbnormalParkingDetection: 'Xe 2 bánh đỗ sai',
  UncoveredTrashCanDetection: 'Thùng rác mở nắp',
  MouseDetect: 'Chuột',
  ShirtlessDetection: 'Không mặc áo',
  SafetyHarnessDetection: 'Không dây an toàn',
  ClimbingDetectionAlarm: 'Trèo leo',
  PeopleGathering: 'Tụ tập',
  FastMoving: 'Di chuyển nhanh',
  StayAloneDetection: 'Thiếu người trực',
  KnifeStickDetection: 'Cầm dao / gậy',
  VehicleOverspeedDetection: 'Xe quá tốc độ',
  ForkliftOverspeedDetection: 'Xe nâng quá tốc độ',
  NoSafetyBeltDetection: 'Không thắt dây an toàn',
  TrafficAccident: 'Tai nạn giao thông',
  Pedestrian: 'Người đi bộ xâm nhập',
  Congestion: 'Ùn tắc',
  Construction: 'Thi công đường',
  GunmanDetection: 'Súng',
  FaceRecognitionAlarm: 'Nhận diện khuôn mặt',
};
const algoName = (t, m, fromBox) => {
  if (fromBox) return fromBox;
  const tr = t?.('algos.' + m);
  if (tr && tr !== ('algos.' + m)) return tr;
  return ALGO_VI[m] || m || '—';
};

/* ---- Camera đang cảnh báo: viền nháy + số. isDetect filter giống
 *      ai.js:1412. clearAlarm tắt hiệu ứng (mọi nút "Bỏ qua"). */
const isDetect = a => a?.type != null && a.type !== 2 && a.type !== 6 && a.type !== 7
  && a?.kind !== 'sse' && a?.algo_model !== 'AreaRuleData';

/* Dòng "key / value" — port row() app.js:267. */
const R = (k, v, cls) => (
  <div className="row">
    <span className="rk">{k}</span>
    <span className={'rv ' + (cls || '')}>{v}</span>
  </div>
);

/* Một phần tử trên thanh lịch sử cảnh báo (.h-item) — port paintHistBar ui.js:1193. */
function HItem({alarm, onPlay, t}) {
  const name = algoName(t, alarm.algo_model, alarm.algo_name);
  const time = alarm.ts ? new Date(alarm.ts * 1000) : null;
  const img = imgOf(alarm);
  const clip = videoOf(alarm);
  return (
    <div className="h-item"
         title={clip ? t('detail.histHint') : t('detail.noClip')}
         style={clip ? {cursor: 'pointer'} : undefined}
         onClick={clip ? () => onPlay?.(alarm) : undefined}>
      {img
        ? <img src={img} alt={'Ảnh phát hiện ' + name} loading="lazy"
               onError={e => {
                 const el = e.currentTarget;
                 const n = +(el.dataset.retry || 0);
                 if (n >= 3) {
                   const d = document.createElement('div');
                   d.className = 'h-noimg';
                   d.textContent = t('live.imgErr');
                   el.replaceWith(d);
                   return;
                 }
                 el.dataset.retry = String(n + 1);
                 const src = el.src;
                 setTimeout(() => { if (el.isConnected) el.src = src; }, 1500);
               }} />
        : <div className="h-noimg">{t('live.noImg')}</div>}
      <div className="h-play"><span>▶</span></div>
      <div className="h-meta">
        <span className="h-algo">{name}</span>
        <span className="h-time">{time ? hms(time) : '—'}</span>
      </div>
    </div>
  );
}

/* ==== Sidebar "Thuật toán AI" của camera đang mở (port cấu trúc thẻ #dAlgos). */
function AlgoRow({model, onOpen, t}) {
  const cat = model ? (catOf(t, model)) : null;
  return (
    <div className="row" style={{padding: '2px 0'}}>
      <span className="rk">{algoName(t, model)}</span>
      <span className="rv dim">{cat || '—'}</span>
    </div>
  );
}
// Nhóm loại (rút gọn từ ALGO_CAT ai.js:195-227) để cột phụ sidebar có ý nghĩa.
const ALGO_CAT = {
  'general': ['ObjectIsRecognized', 'FieldDetectorObjectsInside', 'LineDetectorCrossed', 'EnterArea', 'LeaveArea', 'AreaRuleData', 'CrowdDensityCriticalAlarm', 'LineRuleData'],
  'environment': ['FireDetection', 'FumesAlarmBegin', 'ChannelBlockageDetection', 'ObjectRemoved', 'UncoveredTrashCanDetection', 'MouseDetect', 'AccessElevatorAlarm'],
  'ppe': ['SafetyHelmetAlarm', 'WorkClothesAlarm', 'ReflectiveClothesDetectionAlarm', 'NoMaskAlarm', 'ShirtlessDetection', 'SafetyHarnessDetection', 'NoSafetyBeltDetection'],
  'behavior': ['SleepingDetectionAlarm', 'OffDutyDetectionAlarm', 'SmokingAlarm', 'TelephoningAlarm', 'PlayMobilePhoneDetection', 'FallOverAlarm', 'ClimbingDetectionAlarm', 'LongStayDetection', 'FightDetectionAlarm', 'PeopleGathering', 'FastMoving', 'StayAloneDetection', 'KnifeStickDetection', 'GunmanDetection'],
  'vehicle': ['AbnormalParkingDetection', 'VehicleOverspeedDetection', 'ForkliftOverspeedDetection'],
  'highway': ['TrafficAccident', 'Pedestrian', 'Congestion', 'Construction'],
  'other': [],
};
const CAT_OF = {};
Object.entries(ALGO_CAT).forEach(([c, ms]) => ms.forEach(m => { CAT_OF[m] = c; }));
const catOf = (t, m) => {
  const key = CAT_OF[m];
  if (!key) return t('categories.other');
  return t('categories.' + key);
};

export default function DetailView({name, go, focus, clip, onClipClose, onPlayClip}) {
  const { t } = useTranslation();
  /* ---- state camera từ /api/cameras (đã có stream 'chN', rtsp, name, algos). */
  const [cam, setCam] = useState(null);
  const [streams, setStreams] = useState(null);   // go2rtc /api/streams (nếu có)
  const [history, setHistory] = useState([]);      // alarm của camera này
  const [uptime, setUptime] = useState(0);         // đồng hồ "Kết nối" (s)
  const [live, setLive] = useState(false);         // player đã lên hình?
  const [playMode, setPlayMode] = useState(null);
  const [muted, setMuted] = useState(false);
  const [ptzOpen, setPtzOpen] = useState(false);
  const [ptzOk, setPtzOk] = useState(false);       // camera có producer onvif://

  const stageRef = useRef(null);
  const t0Ref = useRef(Date.now());
  const [paused, setPaused] = useState(false);

  /* ---- Load danh sách camera -> tìm entry của `name`. ---- */
  useEffect(() => {
    let alive = true;
    jget('/api/cameras', 8000)
      .then(j => {
        if (!alive || j.code !== 0) return;
        const hit = (j.data || []).find(c => c.stream === name) || null;
        if (hit) setCam(hit);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [name]);

  /* ---- Load go2rtc /api/streams (nếu có, để lấy producer url / codec). ---- */
  useEffect(() => {
    let alive = true;
    jget(G + 'api/streams', 6000)
      .then(j => { if (alive) setStreams(j); })
      .catch(() => { if (alive) setStreams(null); });
    return () => { alive = false; };
  }, [name]);

  /* ---- Load lịch sử cảnh báo của camera này (thanh dưới). ---- */
  const loadHistory = useCallback(() => {
    const cid = cam ? cam.channel_id : null;
    fetch(BASE + 'api/alarms', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})})
      .then(r => r.json())
      .then(j => {
        if (j.code !== 0) { setHistory([]); return; }
        const all = (j.data || []).filter(isDetect);
        const mine = cid != null
          ? all.filter(a => a.channel_id === cid)
          : all.filter(a => a.channel_name === name || a.channel_id === name?.replace('ch', ''));
        setHistory(dedupBest(mine).slice(0, 40));
      })
      .catch(() => {});
  }, [cam, name]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  /* ---- Đồng hồ uptime của session. ---- */
  useEffect(() => {
    const iv = setInterval(() => setUptime(Math.floor((Date.now() - t0Ref.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  const wsSrc = (name && !clip) ? (G + 'api/ws?src=' + encodeURIComponent(name)) : null;
  const {ref: wrapRef, state} = useVideoStream(
    wsSrc,
    {mode: 'webrtc,mse', media: 'video,audio', visibilityCheck: false},
    d => {
      if (d.state === 'live') { setLive(true); setPlayMode(d.mode || 'RTC'); }
      else if (d.state !== 'retry') { setLive(false); }
      if (d.state === 'error') { setPlayMode(null); }
    },
  );

  /* ---- PTZ: chỉ hiện joystick khi camera có producer onvif:// (như ptzHas). ---- */
  useEffect(() => {
    if (!cam) return;
    const p = (streams || {})[name];
    const hasOnvif = (p?.producers || []).some(x => String(x?.url || '').startsWith('onvif://'));
    setPtzOk(!!hasOnvif);
    if (!hasOnvif) setPtzOpen(false);
  }, [cam, streams, name]);

  const [hasHome, setHasHome] = useState(false);
  useEffect(() => {
    if (!ptzOpen || !ptzOk) return;
    let live = true;
    ptzReq({src: name, cmd: 'has_home'}).then(j => { if (live) setHasHome(!!j?.has); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptzOpen, name]);

  const ptzReq = body => fetch(BASE + 'api/ptz', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }).then(r => r.json().catch(() => ({}))).catch(() => ({}));

  const STEP_MS = 220;
  const ptzStop = useRef(0);      // id setTimeout của lệnh stop đang chờ
  const ptzDownAt = useRef(0);    // mốc lúc nhấn, để đo đã giữ bao lâu
  const ptzMoving = useRef(false); // camera đang chạy (chưa nhận 'stop')

  const sendStop = () => {
    ptzStop.current = 0;
    ptzMoving.current = false;
    ptzReq({src: name, cmd: 'stop'});
  };

  const ptzHold = (pz, e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget._pz = true;
    const move = {up: {tilt: 0.4}, down: {tilt: -0.4}, left: {pan: -0.4}, right: {pan: 0.4}}[pz]
      || (pz === 'zin' ? {zoom: 0.4} : pz === 'zout' ? {zoom: -0.4} : null);
    if (!move) return;
    clearTimeout(ptzStop.current);   // huỷ 'stop' còn treo của cú bấm trước
    ptzStop.current = 0;
    ptzDownAt.current = Date.now();
    ptzMoving.current = true;
    ptzReq({src: name, cmd: 'move', ...move});
  };

  const ptzRelease = e => {
    if (!e.currentTarget._pz) return;
    e.currentTarget._pz = false;
    const wait = Math.max(0, STEP_MS - (Date.now() - ptzDownAt.current));
    clearTimeout(ptzStop.current);
    ptzStop.current = setTimeout(sendStop, wait);
  };

  useEffect(() => () => {
    if (!ptzMoving.current && !ptzStop.current) return;
    clearTimeout(ptzStop.current);
    sendStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  /* ---- Sidebar rows: từ camera (/api/cameras) + go2rtc streams (nếu có). ---- */
  const producer = (streams || {})[name]?.producers?.[0];
  const pUrl = producer?.url || cam?.rtsp || null;
  const dash = <span className="rv none">—</span>;
  const audioSrc = (cam?.algos || []).length ? t('detail.audioExist') : null;
  const row1 = (
    <>
      {R(t('detail.url'), pUrl ? mask(pUrl) : dash, 'dim')}
      {R(t('detail.source'), producer ? `${producer.remote_addr || '—'} · ${producer.protocol || '—'}` : dash)}
      {R(t('detail.codec'), producer?.receivers?.some?.(x => x.codec?.codec_type === 'video') ? 'H.264' : dash)}
      {R(t('detail.bitrate'), dash)}
      {R(t('detail.audio'), t('detail.audioNone'), 'none')}
      {R(t('detail.viewers'), String((streams || {})[name]?.consumers?.length ?? 0))}
    </>
  );
  const row2 = (
    <>
      {R(t('detail.mode'), live ? (playMode || 'RTC') : t('detail.connecting'), live ? 'ok' : 'warn')}
      {R(t('detail.resolution'), dash)}
      {R(t('detail.fps'), dash)}
      {R(t('detail.dropped'), dash)}
      {R(t('detail.rtt'), dash)}
      {R(t('detail.connection'), `${Math.floor(uptime / 60)}m ${pad(uptime % 60)}s`)}
    </>
  );

  const qual = live ? (playMode ? playMode + '' : '') : t('detail.waitingStream');

  const [clipMsg, setClipMsg] = useState(null);
  useEffect(() => { setClipMsg(clip ? 'load' : null); }, [clip?.url]);

  const algos = (cam?.algos || []);

  return (
    <section className="view" id="v-detail">
      <div className="view-wrap" style={{gap: 14}}>
        {/* ===== split: stage + sidebar (grid 2 cột), hist-bar full width ===== */}
        <div data-split
             style={{flex: 1, minHeight: 0, display: 'grid',
                     gridTemplateColumns: 'minmax(0,1fr) 322px', gap: 14, alignItems: 'stretch'}}>

          {/* ---- stage ---- */}
          <div className="stage-wrap" style={{minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 0}}>
            <div className="stage" id="stage" data-stage ref={stageRef}
                 style={{position: 'relative', width: '100%', flex: 1, minHeight: 0}}>
              <span data-edge="top" /><span data-edge="right" /><span data-edge="bottom" /><span data-edge="left" />
              <div className="s-scrim"
                   style={{position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
                           background: 'linear-gradient(180deg,rgba(0,0,0,.34) 0%,transparent 22%,transparent 62%,rgba(0,0,0,.55) 100%)'}} />
              {/* live player */}
              <div ref={wrapRef}
                   style={{position: 'absolute', inset: 0, zIndex: 1}} />
              {clip && (
                <>
                  <video className="vod-v" controls autoPlay playsInline src={clip.url}
                         onLoadedData={() => setClipMsg(null)}
                         onError={() => setClipMsg('err')} />
                  {clipMsg && (
                    <div className={'vod-msg' + (clipMsg === 'err' ? ' err' : '')}>
                      {clipMsg === 'err'
                        ? t('detail.clipPlayErr')
                        : t('detail.clipLoading')}
                    </div>
                  )}
                </>
              )}
              <div className="s-top">
                {clip
                  ? <span className="live back" id="dLive" title={t('detail.backToLive')}
                          style={{cursor: 'pointer'}} onClick={() => onClipClose?.()}>
                      <span className="dot" />LIVE
                    </span>
                  : <span className={'live' + (live ? '' : ' wait')} id="dLive">
                      <span className="dot" />LIVE
                    </span>}
                <span className="qual" id="dQual">
                  {clip ? (clip.algo || t('detail.detectedClip')) : qual}
                </span>
              </div>
              <div className="s-bot">
                <button id="dPlay" title={paused ? t('detail.play') : t('detail.pause')}
                        onClick={e => {
                          const v = wrapRef.current?.querySelector('video');
                          if (!v) return;
                          if (v.paused) v.play(); else v.pause();
                          setPaused(v.paused);
                        }}>{paused ? '▶' : '⏸'}</button>
                <button id="dMute" title={muted ? t('detail.unmute') : t('detail.mute')}
                        onClick={() => {
                          const v = wrapRef.current?.querySelector('video');
                          const next = !muted;
                          if (v) v.muted = next;
                          setMuted(next);
                        }}>
                  {muted ? '🔇' : '🔊'}
                </button>
                <button id="dFull" title={t('detail.fullscreen')}
                        onClick={() => { const st = stageRef.current; document.fullscreenElement ? document.exitFullscreen() : st?.requestFullscreen?.(); }}>⛶</button>
                <button id="ptzToggle" title={t('detail.ptzControl')}
                        className={'ptz-toggle' + (ptzOpen ? ' on' : '')}
                        hidden={!ptzOk}
                        onClick={() => setPtzOpen(o => !o)}>✥</button>
                <div className="grow" />
                <span className="qual" id="dUp">{live ? (t('detail.mode') + ' ' + (playMode || '')) : '—'}</span>
              </div>

              {/* PTZ round joystick */}
              <div className="ptz" id="ptz" hidden={!ptzOpen}>
                <div className="ptz-dial" id="ptzDial">
                  <button data-pz="up" className="pz-q up" title={t('detail.ptzUp')}
                          onPointerDown={e => ptzHold('up', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="left" className="pz-q left" title={t('detail.ptzLeft')}
                          onPointerDown={e => ptzHold('left', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="home" className="pz-home" title={t('detail.ptzHome')}
                          onClick={() => ptzReq({src: name, cmd: 'home'})}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6" /><path d="M8.5 12h7M12 8.5v7" /></svg>
                  </button>
                  <button data-pz="right" className="pz-q right" title={t('detail.ptzRight')}
                          onPointerDown={e => ptzHold('right', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="down" className="pz-q down" title={t('detail.ptzDown')}
                          onPointerDown={e => ptzHold('down', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside style={{minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 0,
                          width: 'auto', overflow: 'visible'}}>
            <div className="card" data-glass style={{flex: 'none', minHeight: '300px', padding: '16px 18px', borderRadius: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
              <div className="card-h" style={{marginBottom: 2}}>{t('detail.streamInfo')}</div>
              <div id="dRows" style={{display: 'flex', flexDirection: 'column', gap: 6}}>{row1}</div>
              <div id="dRows2" style={{borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6}}>{row2}</div>
            </div>
            <div className="card" data-glass style={{flex: 1, minHeight: 0, borderRadius: 18}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6}}>
                <span className="card-h">{t('detail.aiAlgos')}</span>
                <div className="grow" />
                <button data-goldbtn style={{height: 26, padding: '0 10px', fontSize: 11, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer'}}
                        onClick={() => go?.('ai')}>
                  <span>{t('detail.aiConfigBtn')}</span>
                  <span style={{opacity: .85}}>→</span>
                </button>
              </div>
              <div id="dAlgos" style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
                {algos.length
                  ? algos.map(m => <AlgoRow key={m} model={m} t={t} />)
                  : <span className="h-none">{t('detail.noAlgos')}</span>}
              </div>
            </div>
          </aside>

          <div className="hist-bar" data-glass style={{gridColumn: '1/-1', borderRadius: 18}}>
            <div className="hist-h" style={{flexWrap: 'wrap'}}>
              <span className="hist-t">{t('detail.alertHistory')}</span>
              <span className="hist-n" id="histN">
                {history.length ? t('detail.alertCount', {count: history.length}) : t('detail.noAlerts')}
              </span>
              <div className="grow" />
              <span style={{font: '400 10px/1 var(--b)', color: 'rgba(229,229,234,.38)', whiteSpace: 'nowrap'}}>
                {t('detail.histHint')}
              </span>
            </div>
            <div className="hist-list nosb" id="hist"
              onWheel={e => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
              {history.length
                ? history.map(a => (
                  <HItem key={evKey(a)} alarm={a} t={t}
                         onPlay={x => onPlayClip?.({
                           url: videoOf(x),
                           algo: algoName(t, x.algo_model, x.algo_name),
                         })} />
                ))
                : <span className="h-none">{t('live.noAlertsFromBox')}</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}