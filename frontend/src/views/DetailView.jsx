import React, {useState, useEffect, useRef, useCallback} from 'react';
import {G, BASE, jget, mask, hms, pad, imgOf, videoOf} from '../api/client.js';
import {useVideoStream} from '../hooks/useVideoStream.js';

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
const algoName = (m, fromBox) => fromBox || ALGO_VI[m] || m || '—';

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
function HItem({alarm, onPlay}) {
  const name = algoName(alarm.algo_model, alarm.algo_name);
  const t = alarm.ts ? new Date(alarm.ts * 1000) : null;
  const img = imgOf(alarm);
  const clip = videoOf(alarm);
  return (
    <div className="h-item"
         title={clip ? 'Bấm để xem lại clip' : 'Cảnh báo này không có clip'}
         style={clip ? {cursor: 'pointer'} : undefined}
         onClick={clip ? () => onPlay?.(alarm) : undefined}>
      {img
        ? <img src={img} alt={'Ảnh phát hiện ' + name} loading="lazy"
               onError={e => {
                 // Box lưu ảnh muộn hơn lúc đẩy alarm -> ảnh vừa tới hay 404 lần đầu.
                 // Thử lại vài nhịp thay vì đóng đinh "ảnh lỗi" (phải đổi tab mới thấy).
                 const el = e.currentTarget;
                 const n = +(el.dataset.retry || 0);
                 if (n >= 3) {
                   const d = document.createElement('div');
                   d.className = 'h-noimg';
                   d.textContent = 'ảnh lỗi';
                   el.replaceWith(d);
                   return;
                 }
                 el.dataset.retry = String(n + 1);
                 const src = el.src;
                 setTimeout(() => { if (el.isConnected) el.src = src; }, 1500);
               }} />
        : <div className="h-noimg">không ảnh</div>}
      <div className="h-meta">
        <span className="h-algo">{name}</span>
        <span className="h-time">{t ? hms(t) : '—'}</span>
      </div>
    </div>
  );
}

/* ==== Sidebar "Thuật toán AI" của camera đang mở (port cấu trúc thẻ #dAlgos). */
function AlgoRow({model, onOpen}) {
  const cat = model ? (catOf(model)) : null;
  return (
    <div className="row" style={{padding: '2px 0'}}>
      <span className="rk">{algoName(model)}</span>
      <span className="rv dim">{cat || '—'}</span>
    </div>
  );
}
// Nhóm loại (rút gọn từ ALGO_CAT ai.js:195-227) để cột phụ sidebar có ý nghĩa.
const ALGO_CAT = {
  'Chức năng chung': ['ObjectIsRecognized', 'FieldDetectorObjectsInside', 'LineDetectorCrossed', 'EnterArea', 'LeaveArea', 'AreaRuleData', 'CrowdDensityCriticalAlarm', 'LineRuleData'],
  'Môi trường': ['FireDetection', 'FumesAlarmBegin', 'ChannelBlockageDetection', 'ObjectRemoved', 'UncoveredTrashCanDetection', 'MouseDetect', 'AccessElevatorAlarm'],
  'Bảo hộ lao động (PPE)': ['SafetyHelmetAlarm', 'WorkClothesAlarm', 'ReflectiveClothesDetectionAlarm', 'NoMaskAlarm', 'ShirtlessDetection', 'SafetyHarnessDetection', 'NoSafetyBeltDetection'],
  'Hành vi': ['SleepingDetectionAlarm', 'OffDutyDetectionAlarm', 'SmokingAlarm', 'TelephoningAlarm', 'PlayMobilePhoneDetection', 'FallOverAlarm', 'ClimbingDetectionAlarm', 'LongStayDetection', 'FightDetectionAlarm', 'PeopleGathering', 'FastMoving', 'StayAloneDetection', 'KnifeStickDetection', 'GunmanDetection'],
  'Phương tiện': ['AbnormalParkingDetection', 'VehicleOverspeedDetection', 'ForkliftOverspeedDetection'],
  'Sự kiện đường cao tốc': ['TrafficAccident', 'Pedestrian', 'Congestion', 'Construction'],
  'Khác': [],
};
const CAT_OF = {};
Object.entries(ALGO_CAT).forEach(([c, ms]) => ms.forEach(m => { CAT_OF[m] = c; }));
const catOf = m => CAT_OF[m] || 'Khác';

export default function DetailView({name, go, focus, clip, onClipClose, onPlayClip}) {
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

  /* ---- Load go2rtc /api/streams (nếu có, để lấy producer url / codec).
   *      Ở MOCK_DATA không có go2rtc nên 404 — rơi về dữ liệu camera. ---- */
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
        setHistory(mine.slice(0, 40));
      })
      .catch(() => {});
  }, [cam, name]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  /* ---- Đồng hồ uptime của session. ---- */
  useEffect(() => {
    const iv = setInterval(() => setUptime(Math.floor((Date.now() - t0Ref.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  /* ---- Stream live: useVideoStream tới go2rtc ws. MOCK không có go2rtc
   *      -> player rơi vào trạng thái error/retry, giao diện vẫn đúng. ---- */
  // Đang xem lại clip -> src null: hook tháo player live và KHÔNG mở WS nữa (clip
  // chiếu trên chính stage này, giống detachDetailPlayer() của bản gốc). Kéo song
  // song cả luồng live thì vừa tốn băng thông vừa tranh tiếng với clip.
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

  // Khi mở bảng PTZ, hỏi box đã lưu home (set_home) chưa -> tô màu nút Lưu nếu có.
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

  // Backend dùng ONVIF ContinuousMove: MỘT lệnh 'move' là camera chạy mãi tới khi
  // có 'stop'. Nên KHÔNG cần interval lặp lệnh (interval cũ chỉ spam lại lệnh đã
  // có hiệu lực). Chỉ cần: nhấn -> move, nhả -> stop.
  //   bấm nhanh -> vẫn để chạy đủ STEP_MS rồi mới stop  => nhích 1 đoạn bé
  //   bấm giữ   -> chạy liên tục cho tới lúc nhả
  // ponytail: STEP_MS 220ms = độ dài 1 bước nhích; đây là núm tinh chỉnh — camera
  // chậm thì tăng, bước đi quá xa thì giảm.
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

  // Handler nhận THẲNG event (onPointerUp={ptzRelease}) -> chỉ 1 tham số.
  // Trước đây khai báo (pz, e) nên e = undefined -> e.currentTarget ném lỗi,
  // lệnh 'stop' không bao giờ chạy -> bấm 1 lần camera chạy mãi.
  const ptzRelease = e => {
    if (!e.currentTarget._pz) return;
    e.currentTarget._pz = false;
    // Nhả sớm hơn STEP_MS thì hoãn 'stop' cho đủ một bước nhìn thấy được.
    const wait = Math.max(0, STEP_MS - (Date.now() - ptzDownAt.current));
    clearTimeout(ptzStop.current);
    ptzStop.current = setTimeout(sendStop, wait);
  };

  // Rời view / đổi camera khi đang giữ nút: pointerup không bao giờ tới, phải
  // gửi 'stop' để camera không quay tiếp sau khi unmount.
  useEffect(() => () => {
    if (!ptzMoving.current && !ptzStop.current) return;
    clearTimeout(ptzStop.current);
    sendStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  /* ---- Tải lại luồng (nút Tải lại luồng) = đổi t0 reset + reload stream. ---- */
  const reload = () => {
    t0Ref.current = Date.now();
    setUptime(0);
  };

  /* ---- Sidebar rows: từ camera (/api/cameras) + go2rtc streams (nếu có). ---- */
  const producer = (streams || {})[name]?.producers?.[0];
  const pUrl = producer?.url || cam?.rtsp || null;
  const dash = <span className="rv none">—</span>;
  const audioSrc = (cam?.algos || []).length ? 'có ở nguồn' : null; // mock chưa kê audio
  const row1 = (
    <>
      {R('URL', pUrl ? mask(pUrl) : dash, 'dim')}
      {R('Nguồn', producer ? `${producer.remote_addr || '—'} · ${producer.protocol || '—'}` : dash)}
      {R('Codec', producer?.receivers?.some?.(x => x.codec?.codec_type === 'video') ? 'H.264' : dash)}
      {R('Bitrate', dash)}
      {R('Âm thanh', 'không có', 'none')}
      {R('Người xem', String((streams || {})[name]?.consumers?.length ?? 0))}
    </>
  );
  const row2 = (
    <>
      {R('Chế độ', live ? (playMode || 'RTC') : 'đang thoả thuận…', live ? 'ok' : 'warn')}
      {R('Phân giải', dash)}
      {R('FPS', dash)}
      {R('Khung rơi', dash)}
      {R('RTT', dash)}
      {R('Kết nối', `${Math.floor(uptime / 60)}m ${pad(uptime % 60)}s`)}
    </>
  );

  const qual = live ? (playMode ? playMode + '' : '') : 'đang chờ hình…';

  // Thông báo phủ trên clip: 'load' khi đang kéo từ box, 'err' khi box không còn giữ
  // đoạn đó. Reset mỗi lần đổi clip (theo url) chứ không theo object, để mở lại đúng
  // clip cũ vẫn hiện "đang tải".
  const [clipMsg, setClipMsg] = useState(null);
  useEffect(() => { setClipMsg(clip ? 'load' : null); }, [clip?.url]);

  const algos = (cam?.algos || []);

  return (
    <section className="view" id="v-detail">
      <div className="view-wrap" style={{gap: 14}}>
        {/* ===== bar ===== */}
        <div className="bar" style={{gap: 12, flexWrap: 'wrap'}}>
          <button data-glassbtn id="back" style={{height: 36, padding: '0 14px'}} onClick={() => go?.('live')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span>Tất cả camera</span>
          </button>
          <div style={{display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0}}>
            <span className="view-h2" id="dName">{name || '—'}</span>
            <span className="view-sub" id="dSrc" style={{fontSize: 11}}>
              {pUrl ? mask(pUrl) : '—'}
            </span>
          </div>
          <div className="grow" />
          <button data-goldbtn id="dAI" style={{height: 36}} onClick={() => go?.('ai')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#2a2410" strokeWidth="1.8"
                 strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
              <path d="M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2M19 12a7 7 0 0 0-.1-1l1.6-1.3-1.7-2.9-1.9.8a7 7 0 0 0-1.7-1L14.8 4H9.2l-.4 2a7 7 0 0 0-1.7 1l-1.9-.8-1.7 2.9L5.1 11a7 7 0 0 0 0 2l-1.6 1.3 1.7 2.9 1.9-.8a7 7 0 0 0 1.7 1l.4 2h5.6l.4-2a7 7 0 0 0 1.7-1l1.9.8 1.7-2.9-1.6-1.3a7 7 0 0 0 .1-1" />
            </svg>
            <span>Cấu hình AI</span>
          </button>
          <button data-glassbtn id="dReload" style={{height: 36, padding: '0 14px'}} onClick={reload}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                 strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}>
              <path d="M20 12a8 8 0 1 1-2.4-5.7M20.5 4v4.2h-4.2" />
            </svg>
            <span>Tải lại luồng</span>
          </button>
        </div>

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
              {/* clip xem lại — chiếu trên CHÍNH stage này (port openVideo ui.js:1012),
                  không phải modal riêng. CSS .vod-v/.vod-msg đã có sẵn trong style.css. */}
              {clip && (
                <>
                  <video className="vod-v" controls autoPlay playsInline src={clip.url}
                         onLoadedData={() => setClipMsg(null)}
                         onError={() => setClipMsg('err')} />
                  {clipMsg && (
                    <div className={'vod-msg' + (clipMsg === 'err' ? ' err' : '')}>
                      {clipMsg === 'err'
                        ? 'Không tải được clip. Box chỉ giữ video trong thời gian ngắn — cảnh báo cũ có thể đã bị xoá khỏi bộ nhớ box.'
                        : 'Đang tải clip từ AI box…'}
                    </div>
                  )}
                </>
              )}
              <div className="s-top">
                {clip
                  ? <span className="live back" id="dLive" title="Bấm để trở về luồng trực tiếp"
                          style={{cursor: 'pointer'}} onClick={() => onClipClose?.()}>
                      <span className="dot" />LIVE
                    </span>
                  : <span className={'live' + (live ? '' : ' wait')} id="dLive">
                      <span className="dot" />LIVE
                    </span>}
                <span className="qual" id="dQual">
                  {clip ? (clip.algo || 'Clip phát hiện') : qual}
                </span>
              </div>
              <div className="s-bot">
                <button id="dPlay" title="Tạm dừng"
                        onClick={e => {
                          const v = wrapRef.current?.querySelector('video');
                          if (!v) return;
                          if (v.paused) v.play(); else v.pause();
                          setPaused(v.paused);
                        }}>{paused ? '▶' : '⏸'}</button>
                <button id="dMute" title={muted ? 'Tắt tiếng' : 'Bật tiếng'}
                        onClick={() => {
                          const v = wrapRef.current?.querySelector('video');
                          const next = !muted;
                          if (v) v.muted = next;
                          setMuted(next);
                        }}>
                  {muted ? '🔇' : '🔊'}
                </button>
                <button id="dFull" title="Toàn màn hình"
                        onClick={() => { const st = stageRef.current; document.fullscreenElement ? document.exitFullscreen() : st?.requestFullscreen?.(); }}>⛶</button>
                <button id="ptzToggle" title="Điều khiển camera"
                        className={'ptz-toggle' + (ptzOpen ? ' on' : '')}
                        hidden={!ptzOk}
                        onClick={() => setPtzOpen(o => !o)}>✥</button>
                <div className="grow" />
                <span className="qual" id="dUp">{live ? 'Chế độ ' + (playMode || '') : '—'}</span>
              </div>

              {/* PTZ round joystick */}
              <div className="ptz" id="ptz" hidden={!ptzOpen}>
                <div className="ptz-dial" id="ptzDial">
                  <button data-pz="up" className="pz-q up" title="Lên"
                          onPointerDown={e => ptzHold('up', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="left" className="pz-q left" title="Trái"
                          onPointerDown={e => ptzHold('left', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="home" className="pz-home" title="Về giữa"
                          onClick={() => ptzReq({src: name, cmd: 'home'})}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6" /><path d="M8.5 12h7M12 8.5v7" /></svg>
                  </button>
                  <button data-pz="right" className="pz-q right" title="Phải"
                          onPointerDown={e => ptzHold('right', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button data-pz="down" className="pz-q down" title="Xuống"
                          onPointerDown={e => ptzHold('down', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </div>
                <div className="ptz-zoom">
                  <button data-pz="zin" title="Phóng to"
                          onPointerDown={e => ptzHold('zin', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                  <button data-pz="zout" title="Thu nhỏ"
                          onPointerDown={e => ptzHold('zout', e)}
                          onPointerUp={ptzRelease} onPointerCancel={ptzRelease} onPointerLeave={ptzRelease}>
                    <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
                  </button>
                  <button data-pz="sethome" title="Lưu vị trí này làm chỗ về giữa"
                          onClick={() => { ptzReq({src: name, cmd: 'set_home'}).then(() => setHasHome(true)); }}
                          style={hasHome ? {
                            color: 'var(--gold2)', borderColor: 'rgba(234,183,72,.7)',
                            background: 'rgba(234,183,72,.14)', boxShadow: '0 0 8px rgba(234,183,72,.35)',
                          } : undefined}>
                    <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ---- sidebar ---- */}
          <aside style={{minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 0,
                          width: 'auto', overflow: 'visible'}}>
            <div className="card" data-glass style={{flex: 'none', borderRadius: 18}}>
              <div className="card-h">Luồng RTSP · Phiên xem</div>
              <div id="dRows">{row1}</div>
              <div id="dRows2">{row2}</div>
            </div>
            <div className="card" data-glass style={{flex: 1, minHeight: 0, borderRadius: 18}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 9}}>
                <span className="card-h">Thuật toán AI</span>
                <div className="grow" />
              </div>
              <div id="dAlgos" style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
                {algos.length
                  ? algos.map(m => <AlgoRow key={m} model={m} />)
                  : <span className="h-none">Camera này chưa bật thuật toán nào</span>}
              </div>
              <div id="dAiCta"
                   style={{marginTop: 'auto', paddingTop: 11, borderTop: '1px solid rgba(255,255,255,.08)',
                           display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer'}}>
                <span style={{font: '600 11px/1 var(--b)', color: '#d5c295'}}>Cấu hình vùng &amp; quy tắc</span>
                <span style={{font: '500 11px/1 var(--b)', color: '#d5c295'}}>→</span>
              </div>
            </div>
          </aside>

          {/* ---- history bar (full width) ---- */}
          <div className="hist-bar" data-glass style={{gridColumn: '1/-1', borderRadius: 18}}>
            <div className="hist-h" style={{flexWrap: 'wrap'}}>
              <span className="hist-t">Lịch sử cảnh báo</span>
              <span className="hist-n" id="histN">
                {history.length ? history.length + ' cảnh báo' : 'chưa có cảnh báo'}
              </span>
              <div className="grow" />
              <span style={{font: '400 10px/1 var(--b)', color: 'rgba(229,229,234,.38)', whiteSpace: 'nowrap'}}>
                cuộn ngang · bấm để xem lại clip
              </span>
            </div>
            <div className="hist-list nosb" id="hist">
              {history.length
                ? history.map(a => (
                  <HItem key={a.event_id != null ? a.event_id : 'ts' + (a.ts || 0)} alarm={a}
                         onPlay={x => onPlayClip?.({
                           url: videoOf(x),
                           algo: algoName(x.algo_model, x.algo_name),
                         })} />
                ))
                : <span className="h-none">Chưa có cảnh báo nào từ AI box cho camera này</span>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}