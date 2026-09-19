import React, {useState, useEffect, useRef, useCallback} from 'react';
import {createPortal} from 'react-dom';
import {BASE, jget, post, G} from '../api/client.js';
import {useVideoStream} from '../hooks/useVideoStream.js';
import { useTranslation } from '../i18n/index.jsx';

/* ============================================================================
   AiView — port của section #v-ai (index.html) + ai.js, cho React.
   Cấu hình AI cho 1 camera: vẽ vùng phát hiện lên ảnh (ROI canvas, GRID=10000),
   chọn thuật toán, chỉnh ngưỡng / lịch canh phòng / liên kết hành động, lưu.

   API: /aibox/algo/list, /aibox/smart/list, /aibox/smart/update,
        /aibox/smart/default/param, /aibox/control/time/get, /aibox/linkage/get
   Trong MOCK_DATA các endpoint box này không fake nên component bám đúng state
   rỗng của bản gốc khi call thất bại, đồng thời vẫn render có nội dung nhờ
   camera list từ /api/cameras (đã mock).
   ============================================================================ */

/* ---------------- tên thuật toán: dịch từ ai.js ALGO_VI ---------------- */
const ALGO_VI = {
  SafetyHelmetAlarm: 'Không mũ bảo hộ', WorkClothesAlarm: 'Không đồng phục',
  TelephoningAlarm: 'Gọi điện thoại', SmokingAlarm: 'Hút thuốc',
  SleepingDetectionAlarm: 'Ngủ khi làm việc', OffDutyDetectionAlarm: 'Vắng mặt',
  ChannelBlockageDetection: 'Chắn lối thoát hiểm', ObjectRemoved: 'Vật để lại',
  FieldDetectorObjectsInside: 'Xâm nhập vùng', AccessElevatorAlarm: 'Xe điện vào thang máy',
  NoMaskAlarm: 'Không khẩu trang', FallOverAlarm: 'Té ngã',
  CrowdDensityCriticalAlarm: 'Quá đông người', ReflectiveClothesDetectionAlarm: 'Không áo phản quang',
  AbnormalParkingDetection: 'Đỗ xe sai / chắn lối chữa cháy',
  AbnormalParkingDetection_HighSpeedEvent: 'Đỗ xe bất thường (giao thông)',
  FumesAlarmBegin: 'Khói', PlayMobilePhoneDetection: 'Dùng điện thoại',
  FireDetection: 'Cháy', LongStayDetection: 'Ở lại quá lâu',
  FightDetectionAlarm: 'Đánh nhau', LineDetectorCrossed: 'Vượt vạch',
  EnterArea: 'Vào vùng', LeaveArea: 'Ra khỏi vùng', AreaRuleData: 'Đếm người trong vùng',
  LineRuleData: 'Đếm người qua vạch', ObjectIsRecognized: 'Nhận diện mặt',
  NonMotorAbnormalParkingDetection: 'Xe 2 bánh đỗ sai', UncoveredTrashCanDetection: 'Thùng rác mở nắp',
  MouseDetect: 'Chuột', BareSoilCoverDetection: 'Đất trống chưa phủ',
  DisorderStackingDetection: 'Xếp vật liệu sai', TrashOverflowingDetection: 'Thùng rác tràn',
  ExposedGarbageDetection: 'Rác lộ thiên', PackedGarbageDetection: 'Rác đóng túi',
  ShirtlessDetection: 'Không mặc áo', ChefHatAlarm: 'Không mũ đầu bếp',
  ChefClothesDetection: 'Không đồng phục đầu bếp', SafetyHarnessDetection: 'Không dây an toàn',
  ClimbingDetectionAlarm: 'Trèo leo', PeopleGathering: 'Tụ tập', FastMoving: 'Di chuyển nhanh',
  StayAloneDetection: 'Thiếu người trực', KnifeStickDetection: 'Cầm dao / gậy',
  UnwashedVehicleDetection: 'Xe chưa rửa', VehicleOverspeedDetection: 'Xe quá tốc độ',
  ForkliftOverspeedDetection: 'Xe nâng quá tốc độ', NoSafetyBeltDetection: 'Không thắt dây an toàn',
  PresetMarkerDetection: 'Mốc định sẵn', GasCylinderDetection: 'Bình gas',
  ChargingGunNotinPlace: 'Súng sạc không đúng chỗ', NoFireExtinguisherDetection: 'Thiếu bình chữa cháy',
  DumpTruckWithoutTarp: 'Xe ben không phủ bạt', OilLeakDetection: 'Rò dầu',
  GasLeakDetection: 'Rò khí', LiquidLeakDetection: 'Rò nước',
  TestPaperColorChangeDetection: 'Giấy thử đổi màu', NoSafetyGogglesDetection: 'Không kính bảo hộ',
  NoSafetyGlovesDetection: 'Không găng tay', NoDustGasMaskDetection: 'Không mặt nạ phòng độc',
  ExposedLongHairDetection: 'Tóc dài không buộc', CampusEntranceExitLPC: 'Biển số ra vào khu',
  CampusVehicleCongestionDetection: 'Ùn xe trong khu', DogDetection: 'Chó',
  FuelUnloadDetect: 'Xả dầu', Construction: 'Thi công đường', ThrowingEvent: 'Ném rác',
  TrafficAccident: 'Tai nạn giao thông', DriveSlowly: 'Xe chạy quá chậm', DriveAway: 'Xe rời đi',
  Fogging: 'Sương mù', NonMotorVehicleIntrusionDetection: 'Xe 2 bánh xâm nhập',
  OccupancyEmergencyLane: 'Chiếm làn khẩn cấp', Pedestrian: 'Người đi bộ xâm nhập',
  Retrograde: 'Xe đi ngược chiều', SnowCover: 'Tuyết phủ mặt đường', Congestion: 'Ùn tắc',
  VehicleEnterExitServiceStation: 'Xe ra vào trạm', ForkliftDetection: 'Xe nâng',
  EngineeringVehicleDetection: 'Xe công trình', IllegalAdditionOfBulkGasoline: 'Bơm xăng trái phép',
  WildlifeIntrusionDetection: 'Động vật xâm nhập', FireOperationUnattended: 'Hàn cắt không người trông',
  SmokeAndFireDetectionEvent: 'Khói và lửa', RestrictedAreaFishingDetection: 'Đánh bắt khu cấm',
  WaterOutletDischargeDetection: 'Xả thải cửa nước', HandDetection: 'Bàn tay',
  FreightInPassengerElevator: 'Chở hàng trong thang khách',
  ElectricBicycleIntrusionDetection: 'Chở hàng trong thang khách',
  LongQueueDetection: 'Xếp hàng dài', LightsLeftOnDetection: 'Quên tắt đèn',
  PedestrianAntiDirectionDetection: 'Người đi ngược chiều', ReverseMotionOnEscalator: 'Đi ngược thang cuốn',
  GunmanDetection: 'Súng', ShipDetection: 'Tàu thuyền', SurfaceWaterDetection: 'Ngập nước mặt đường',
  TrafficParameters: 'Thông số giao thông', TrafficParameter: 'Thông số giao thông',
};
const algoName = (t, m, fromBox) => {
  if (fromBox) return fromBox;
  const tr = t?.('algos.' + m);
  if (tr && tr !== ('algos.' + m)) return tr;
  return ALGO_VI[m] || m;
};

const GRID = 10000; // hệ toạ độ của box, không phải pixel
const STROKE = 1.25;  // độ dày nét vẽ vùng (px CSS) — nét mảnh đỡ răng cưa

const AREA = {kind: 'polygon', key: 'polygon', min: 3, max: 6, label: 'vùng phát hiện'};
const MASK = {kind: 'polygon', key: 'polygon', min: 3, max: 6, label: 'vùng che'};
const LINE = {kind: 'line', key: 'line', min: 2, max: 2, label: 'đường thẳng'};
const DIR = {kind: 'line', key: 'direction_line', min: 2, max: 2, label: 'đường chỉ hướng'};
const STEP_LINE_DIR = [LINE, DIR];
const STEP_AREA_LINE = [AREA, DIR];
const STEPS = {
  LineDetectorCrossed: STEP_LINE_DIR, LineRuleData: STEP_LINE_DIR,
  ClimbingDetectionAlarm: STEP_AREA_LINE, VehicleOverspeedDetection: STEP_AREA_LINE,
  ForkliftOverspeedDetection: STEP_AREA_LINE, PedestrianAntiDirectionDetection: STEP_AREA_LINE,
  ReverseMotionOnEscalator: STEP_AREA_LINE, LongQueueDetection: [LINE],
};
const stepsOf = (m, usage) =>
  usage === 'NotROI' ? [MASK] : (STEPS[m] || [AREA]);

const ZONE_COLORS = ['#5fe3d0', '#e5bc63', '#b57cff', '#ff5b45', '#3ddc84', '#7aa2f7'];
const zoneColor = i => ZONE_COLORS[i % ZONE_COLORS.length];

const DAYS = [['monday', 'T2'], ['tuesday', 'T3'], ['wednesday', 'T4'], ['thursday', 'T5'],
              ['friday', 'T6'], ['saturday', 'T7'], ['sunday', 'CN']];
const OBJ_TYPES = [[1, 'Người đi bộ'], [2, 'Xe động cơ'], [3, 'Xe không động cơ']];
const SLOTS = 48;
const HH = t => String(Math.floor(t / 2)).padStart(2, '0') + ':' + (t % 2 ? '30' : '00');
const SC_PRESETS = [
  ['Cả ngày', () => Array(SLOTS).fill(true)],
  ['Giờ hành chính', () => Array.from({length: SLOTS}, (_, t) => t / 2 >= 8 && t / 2 < 18)],
  ['Ban đêm', () => Array.from({length: SLOTS}, (_, t) => t / 2 >= 18 || t / 2 < 6)],
  ['Tắt hết', () => Array(SLOTS).fill(false)],
];

const FIELD = {
  sensitive: {l: 'Độ nhạy', h: '0 – 100 · càng cao càng dễ báo', lo: 0, hi: 100, st: 5},
  report_rate: {l: 'Giãn cách cảnh báo', h: 'giây · 0 = báo mọi lần', lo: 0, hi: 21600, st: 5},
  time_threshold: {l: 'Ngưỡng thời gian', h: 'giây · vật ở trong vùng bao lâu mới báo', lo: 0, hi: 300, st: 1},
  person_num_limit: {l: 'Giới hạn số người', h: 'vượt số này thì báo', lo: 0, hi: 200, st: 1},
  back_time_threshold: {l: 'Ngưỡng quay lại', h: 'giây', lo: 0, hi: 3600, st: 10},
  standard_line: {l: 'Vạch chuẩn', h: '0 – 100 · vị trí vạch so sánh', lo: 0, hi: 100, st: 5},
  leashlength: {l: 'Độ dài dây dắt', h: 'mét', lo: 0, hi: 10, st: 1},
  line_dpc_time: {l: 'Thời gian chờ qua vạch', h: 'giây', lo: 0, hi: 300, st: 1},
  line_dpc_enable: {l: 'Lọc qua vạch trùng lặp', sw: 1},
  fall_mode: {l: 'Chế độ té ngã', h: '0 = thường · 1 = nghiêm ngặt', sw: 1},
  feature_mode: {l: 'Chế độ đặc trưng', h: '0 = nhanh · 1 = chính xác', sw: 1},
  algo_model_mode: {l: 'Chế độ thuật toán', h: '0 = thường · 1 = nâng cao', sw: 1},
  enable_work_clothes_alarm: {l: 'Báo sai trang phục', sw: 1},
  cap_large_dog: {l: 'Bắt cả chó lớn', sw: 1},
};
const SZ_GROUPS = [['person', 'Người'], ['vehicle', 'Xe động cơ'], ['nonvehicle', 'Xe không động cơ']];
const RAW_FIELD = {
  lanes: 'Làn đường', workclothes_lib_list: 'Thư viện trang phục',
  speed_info: 'Ngưỡng tốc độ', congestion_info: 'Ngưỡng tắc nghẽn',
  preview_img: 'Ảnh mẫu', without_leash_time: 'Thời gian không dây dắt',
  ship_type: 'Loại tàu', autotime_info: 'Lịch tự động',
};

/* ---------------- toạ độ CSV <-> mảng điểm ---------------- */
function parsePts(g) {
  if (!g) return [];
  const xs = String(g.point_x || '').split(',').filter(s => s !== '');
  const ys = String(g.point_y || '').split(',').filter(s => s !== '');
  return xs.map((x, i) => [+x, +ys[i]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
const dumpPts = pts => ({
  point_x: pts.map(p => Math.round(p[0])).join(','),
  point_y: pts.map(p => Math.round(p[1])).join(','),
});
function graphsFrom(model, done, usage) {
  const g = {graph_usage: usage};
  done.forEach(d => g[d.key] = dumpPts(d.pts));
  g.graph_type = done.length > 1 ? 'blend'
    : done[0]?.key === 'line' ? 'line' : 'polygon';
  return [g];
}

/* ---------------- các helper con ---------------- */

/** O so co nut -/+ (design dung -/+ chu khong phai thanh truot). */
function Spin({val, lo, hi, step, onChange}) {
  const [v, setV] = useState(val);
  useEffect(() => setV(val), [val]);
  const set = n => {
    const x = Math.max(lo, Math.min(hi, Math.round(n)));
    setV(x);
    onChange(x);
  };
  return (
    <div className="spin">
      <button onClick={() => set(+v - step)}>−</button>
      <input className="v" inputMode="numeric" value={v}
        onChange={e => set(+e.target.value || lo)} />
      <button onClick={() => set(+v + step)}>+</button>
    </div>
  );
}

/** Dòng label + hint + control trong pane Quy tắc / Liên kết. */
function CfgRow({label, hint, children}) {
  return (
    <div className="cfg-row">
      <div className="cfg-lb"><span className="l">{label}</span><span className="h">{hint}</span></div>
      {children}
    </div>
  );
}

/** Công tắc bật/tắt (design dùng .sw-row/.sw-tr/.sw-kn). */
function SwRow({label, meta, on, onChange}) {
  const [cur, setCur] = useState(!!on);
  useEffect(() => setCur(!!on), [on]);
  return (
    <div className={'sw-row' + (cur ? ' on' : '')} onClick={() => {
      const next = !cur;
      setCur(next);
      onChange(next);
    }}>
      <div className="tx"><span className="l">{label}</span><span className="m">{meta}</span></div>
      <div className="sw-tr"><span className="sw-kn"></span></div>
    </div>
  );
}

const head = txt => <div className="cfg-h">{txt}</div>;
const sep = () => <div className="cfg-sep"></div>;

/* ---------------- component chính ---------------- */
export default function AiView({focus, go}) {
  const { t } = useTranslation();
  const [ch, setCh] = useState(null);          // channel_id đang cấu hình
  const [name, setName] = useState(null);      // tên stream ch<id>

  const [smart, setSmart] = useState([]);      // các task thuật toán của camera
  const [loaded, setLoaded] = useState([]);    // thuật toán box đã nạp (picker)
  const [defs, setDefs] = useState([]);        // default param của 94 thuật toán
  const [sel, setSel] = useState(null);        // thuật toán đang chọn

  // trạng thái vẽ vùng (chuyển thành state để re-render canvas mỗi khi đổi)
  const [pts, setPts] = useState([]);
  const [done, setDone] = useState([]);
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState('idle');    // 'idle' | 'draw'
  const [pick, setPick] = useState(null);
  const [usage, setUsage] = useState('ROI');
  const [tab, setTab] = useState('rule');      // rule | sched | link
  const [sched, setSched] = useState(null);    // lịch canh phòng cells
  const [link, setLink] = useState(null);      // liên kết hành động
  const [web, setWeb] = useState({});          // linkage/web config theo camera
  const [cap, setCap] = useState(null);        // công suất còn (hashrate)

  const [picker, setPicker] = useState(false); // modal nạp thuật toán
  const [fpSel, setFpSel] = useState(new Set());
  const [fpCap, setFpCap] = useState(null);
  const [fpOver, setFpOver] = useState(false);
  const [fpBusy, setFpBusy] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);

  const [confirm, setConfirm] = useState(null); // {title,msg,sub,yes,onYes} hoặc null
  const [saving, setSaving] = useState(false);

  const cvRef = useRef(null);
  const shotRef = useRef(null);
  const dragRef = useRef(null);               // {di, i} mốc đang kéo (di<0 = pts)
  const skipClickRef = useRef(false);
  const [csz, setCsz] = useState(0);          // đổi khi canvas đổi kích thước -> vẽ lại

  /* ---- nạp danh sách camera khi mở ---- */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const j = await jget(BASE + 'api/cameras');
        const list = (j.data || []).filter(c => c.stream);
        if (!live) return;
        // mở camera focus (bấm "Cấu hình AI" ở tab Camera / Chi tiết), fallback camera đầu tiên
        const target = (focus && list.find(c => c.stream === focus || c.name === focus))
          || list[0];
        if (target) selectCamera(target.channel_id, target.stream);
      } catch { /* không có box thì để trống, phần picker camera vẫn cho xem */ }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Đặt camera cấu hình rồi nạp cấu hình AI của nó (port openAI). */
  const selectCamera = useCallback(async (channelId, streamName) => {
    setCh(channelId);
    setName(streamName);
    setSel(null); setPts([]); setDone([]); setMode('idle'); setPick(null);
    setUsage('ROI'); setTab('rule'); setSched(null); setLink(null); setWeb({}); setCap(null);
    setSmart([]); setLoaded([]); setDefs([]);
    try {
      const [algo, cur, smartD, defsD] = await Promise.all([
        post('algo/list'),
        post('algo/list/current').catch(() => ({})),
        post('smart/list', {channel_id: channelId}).catch(() => ({})),
        post('smart/default/param').catch(() => ({})),
      ]);
      setLoaded(cur.algo_model || []);
      setDefs(defsD.smart_list || []);
      setSmart(smartD.smart_list || []);
      setSel((smartD.smart_list || [])[0]?.algo_model || null);
      loadCap(channelId, (smartD.smart_list || []).map(tState => tState.algo_model));
    } catch {
      // box không nạp được -> giữ state rỗng (gốc hiện "Đang đọc…" rồi bỏ)
    }
  }, []);

  const loadCap = async (cid, algos) => {
    try {
      const j = await fetch(BASE + 'api/hashrate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({channel_id: cid, algo_model: algos || []}),
      }).then(r => r.json());
      const v = j?.data?.hashrate;
      setCap(v != null ? v : null);
    } catch { setCap(null); }
  };

  /* ---- vẽ canvas mỗi khi state vẽ đổi ---- */
  useEffect(() => {
    const c = cvRef.current;
    if (!c) return;
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);   // vẽ theo CSS px, nét trên HiDPI
    const w = c.width / dpr, h = c.height / dpr;
    g.clearRect(0, 0, w, h);
    const px = p => [p[0] / GRID * w, p[1] / GRID * h];
    const shape = (points, closed, col, alpha, arrow) => {
      if (!points.length) return;
      g.globalAlpha = alpha;
      g.lineWidth = STROKE;
      g.strokeStyle = col;
      g.beginPath();
      points.forEach((p, i) => {
        const [x, y] = px(p);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      if (closed && points.length > 2) {
        g.closePath();
        g.fillStyle = col + '24';
        g.fill();
      }
      g.stroke();
      if (arrow && points.length >= 2) {
        const [x1, y1] = px(points[0]), [x2, y2] = px(points[points.length - 1]);
        const a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        g.beginPath();
        g.moveTo(mx + 9 * Math.cos(a), my + 9 * Math.sin(a));
        g.lineTo(mx + 9 * Math.cos(a + 2.5), my + 9 * Math.sin(a + 2.5));
        g.lineTo(mx + 9 * Math.cos(a - 2.5), my + 9 * Math.sin(a - 2.5));
        g.closePath();
        g.fillStyle = col;
        g.fill();
      }
      g.font = '700 9px JetBrains Mono, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      points.forEach((p, i) => {
        const [x, y] = px(p);
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fillStyle = col;
        g.fill();
        g.fillStyle = '#0a0c0f';
        g.fillText(i + 1, x, y);
      });
      g.globalAlpha = 1;
    };
    // vùng đã lưu
    const tState = smart.find(x => x.algo_model === sel) || null;
    const graphs = tState?.graphs || [];
    graphs.forEach((gr, i) => {
      const col = zoneColor(i);
      const on = pick === i;
      const sts = stepsOf(sel, gr.graph_usage === 'NotROI' ? 'NotROI' : 'ROI');
      sts.forEach(st => shape(parsePts(gr[st.key]), st.kind === 'polygon', col, on ? 1 : 0.62, st.key === 'direction_line'));
    });
    // vùng đang vẽ
    const col = zoneColor(graphs.length);
    done.forEach(d => shape(d.pts, d.key === 'polygon', col, 0.85, d.key === 'direction_line'));
    const s = mode === 'draw' ? (stepsOf(sel, usage)[done.length] || null) : null;
    if (s) {
      shape(pts, s.kind === 'polygon', col, 1, s.key === 'direction_line');
      if (hover && pts.length && pts.length < s.max && !dragRef.current) {
        const [x1, y1] = px(pts[pts.length - 1]);
        const [hx, hy] = px(hover);
        g.save();
        g.lineWidth = STROKE;
        g.strokeStyle = col;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(hx, hy);
        if (s.kind === 'polygon' && pts.length >= 2) {
          const [x0, y0] = px(pts[0]);
          g.lineTo(x0, y0);
        }
        g.stroke();
        g.restore();
      }
    }
  }, [smart, sel, pts, done, hover, mode, usage, pick, csz]);

  /* ---- cập nhật kích thước canvas theo hộp #aiShot ---- */
  useEffect(() => {
    const shot = shotRef.current, cv = cvRef.current;
    if (!shot || !cv) return;
    const apply = entry => {
      const dpr = window.devicePixelRatio || 1;
      const dp = entry?.devicePixelContentBoxSize?.[0];
      const r = shot.getBoundingClientRect();
      const w = dp ? dp.inlineSize : Math.round(r.width * dpr);
      const h = dp ? dp.blockSize : Math.round(r.height * dpr);
      if (!w || !h || (cv.width === w && cv.height === h)) return;
      cv.width = w;
      cv.height = h;
      setCsz(n => n + 1);   // đổi width xoá canvas -> buộc vẽ lại
    };
    const ro = new ResizeObserver(es => apply(es[es.length - 1]));
    const observe = () => {
      try { ro.observe(shot, {box: 'device-pixel-content-box'}); }
      catch { ro.observe(shot); }
    };
    observe();
    let mq;
    const onDpr = () => { ro.unobserve(shot); observe(); watch(); };
    const watch = () => {
      mq?.removeEventListener('change', onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    watch();
    return () => { ro.disconnect(); mq?.removeEventListener('change', onDpr); };
  }, []);

  /* ---- chuyển toạ độ chuột -> hệ 0~10000 ---- */
  const at = useCallback(ev => {
    const cv = cvRef.current;
    if (!cv) return [0, 0];
    const r = cv.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * GRID, (ev.clientY - r.top) / r.height * GRID];
  }, []);

  const findPt = useCallback((p, ptsArr, doneArr) => {
    const HIT = 260;
    const near = list => {
      for (let i = 0; i < list.length; i++) {
        const dx = list[i][0] - p[0], dy = list[i][1] - p[1];
        if (dx * dx + dy * dy <= HIT * HIT) return i;
      }
      return -1;
    };
    let i = near(ptsArr);
    if (i >= 0) return {di: -1, i};
    for (let d = 0; d < doneArr.length; d++) {
      i = near(doneArr[d].pts);
      if (i >= 0) return {di: d, i};
    }
    return null;
  }, []);

  const endStep = useCallback((ptsArr, doneArr, curPts, curDone, curSel, curUsage) => {
    const all = stepsOf(curSel, curUsage);
    const s = all[curDone.length] || null;
    if (!s) return {ptsArr, doneArr, note: null};
    if (curPts.length < s.min) return {ptsArr, doneArr, note: `${s.label}: cần ${s.min} điểm`};
    const nd = [...curDone, {key: s.key, pts: curPts.slice()}];
    const nx = all[nd.length] || null;
    return {ptsArr: [], doneArr: nd, note: nx ? `Xong ${s.label} → vẽ tiếp ${nx.label}` : null};
  }, []);

  /* ---- handlers canvas ---- */
  const onMouseDown = ev => {
    if (ev.button !== 0 || !sel || mode !== 'draw') return;
    const p = at(ev);
    const hit = findPt(p, pts, done);
    if (hit) dragRef.current = hit;
  };
  const onMouseMove = ev => {
    const p = at(ev);
    const cv = cvRef.current;
    if (dragRef.current) {
      const {di, i} = dragRef.current;
      if (di < 0) setPts(a => a.map((q, k) => (k === i ? p : q)));
      else setDone(a => a.map((d, k) =>
        (k === di ? {...d, pts: d.pts.map((q, j) => (j === i ? p : q))} : d)));
      return;
    }
    if (mode !== 'draw') { if (cv) cv.style.cursor = 'default'; return; }
    setHover(p);
    const s = stepsOf(sel, usage)[done.length] || null;
    if (cv) cv.style.cursor = findPt(p, pts, done) ? 'grab' : s ? 'crosshair' : 'default';
  };
  const onMouseUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    skipClickRef.current = true;
  };
  const onMouseLeave = () => { dragRef.current = null; setHover(null); };
  const onCanvasClick = ev => {
    if (skipClickRef.current) { skipClickRef.current = false; return; }
    if (!sel) return;
    const all = stepsOf(sel, usage);
    const s = all[done.length] || null;
    if (!s) return;
    const p = at(ev);
    if (pts.length >= s.min && findPt(p, pts, done)) {
      const r = endStep(pts, done, pts, done, sel, usage);
      if (r.note) console.info(r.note);
      setPts([]); setDone(r.doneArr);
      return;
    }
    if (pts.length >= s.max) return;
    const np = [...pts, p];
    setPts(np);
    if (np.length === s.max && s.kind === 'line') {
      const r = endStep(np, done, np, done, sel, usage);
      if (r.note) console.info(r.note);
      setPts([]); setDone(r.doneArr);
    }
  };
  const onContextMenu = ev => {
    ev.preventDefault();
    const s = stepsOf(sel, usage)[done.length] || null;
    if (s && pts.length >= s.min) {
      const r = endStep(pts, done, pts, done, sel, usage);
      if (r.note) console.info(r.note);
      setPts([]); setDone(r.doneArr);
    } else {
      setPts(pts.slice(0, -1));
    }
  };

  /* ---- stream làm nền vẽ vùng ---- */
  const {ref: streamWrapRef} = useVideoStream(name ? G + 'api/ws?src=' + encodeURIComponent(name) : null,
    {mode: 'webrtc,mse', media: 'video', visibilityThreshold: 0.01},
    () => {});

  /* ---- hint dưới nút Vẽ vùng ---- */
  let hintText = 'Chọn thuật toán trước khi vẽ vùng';
  let hintColor = 'var(--faint)';
  if (sel) {
    const all = stepsOf(sel, usage), s = all[done.length] || null, n = pts.length;
    const k = done.length + 1, tot = all.length;
    const pos = tot > 1 ? `Bước ${k}/${tot} · ` : '';
    if (mode !== 'draw') {
      hintText = 'Bấm "Vẽ vùng" để vẽ · bấm vùng trên ảnh để chọn';
    } else if (!s) {
      hintText = `Đã vẽ đủ ${tot} bước — bấm Lưu cấu hình`;
    } else if (n < s.min) {
      hintText = `${pos}${s.label}: cần ${s.min} điểm (đang có ${n}) · bấm trái để thêm`;
    } else if (n >= s.max) {
      hintText = `${pos}${s.label}: đủ ${s.max} điểm — bấm PHẢI để kết thúc`;
    } else {
      hintText = `${pos}${s.label}: ${n}/${s.max} điểm · bấm phải để kết thúc`;
    }
    if (s && n && n < s.min) hintColor = 'var(--warn)';
  }

  /* ---- tab pane ---- */
  const paneRule = () => {
    const tState = smart.find(x => x.algo_model === sel) || null;
    if (!tState) return <div className="zone-none">Chọn một thuật toán để cấu hình</div>;
    const els = [];
    const nums = Object.keys(FIELD).filter(k => tState[k] != null);
    if (nums.length) {
      els.push(head('Ngưỡng phát hiện'));
      els.push(
        <div className="cfg-rows" key="rows">
          {nums.map(k => {
            const f = FIELD[k];
            return f.sw
              ? <SwRow key={k} label={f.l} meta={f.h || ''} on={!!tState[k]}
                  onChange={on => { const s = smart.slice(); const tt = s.find(x => x.algo_model === sel); tt[k] = on ? 1 : 0; setSmart(s); }} />
              : <CfgRow key={k} label={f.l} hint={f.h}>
                  <Spin val={tState[k]} lo={f.lo} hi={f.hi} step={f.st}
                    onChange={v => { const s = smart.slice(); const tt = s.find(x => x.algo_model === sel); tt[k] = v; setSmart(s); }} />
                </CfgRow>;
          })}
        </div>,
      );
    }
    const szKeys = SZ_GROUPS.filter(([p]) =>
      tState[`max_${p}_object_width`] != null || tState[`min_${p}_object_height`] != null);
    if (szKeys.length) {
      els.push(sep(), head('Kích thước đối tượng (0~10000)'));
      const sz = [];
      for (const [pre, glabel] of szKeys) {
        for (const [lb, mm] of [['Tối đa', 'max'], ['Tối thiểu', 'min']]) {
          const g = [];
          const lab = szKeys.length > 1 ? `${glabel} · ${lb.toLowerCase()}` : lb;
          const cells = [];
          for (const [ax, dim] of [['Rộng', 'width'], ['Cao', 'height']]) {
            const key = `${mm}_${pre}_object_${dim}`;
            if (tState[key] == null) continue;
            cells.push(
              <div className="cfg-ax" key={key}>
                <span className="a">{ax}</span>
                <Spin val={tState[key]} lo={0} hi={10000} step={50}
                  onChange={v => { const s = smart.slice(); const tt = s.find(x => x.algo_model === sel); tt[key] = v; setSmart(s); }} />
              </div>,
            );
          }
          if (cells.length) g.push(
            <div className="cfg-sz-g" key={mm + pre}>
              <span className="l">{lab}</span>
              <div className="cfg-sz-r">{cells}</div>
            </div>,
          );
          sz.push(...g);
        }
      }
      if (sz.length) els.push(<div className="cfg-sz" key="sz">{sz}</div>);
    }
    if (tState.object_type != null) {
      els.push(sep(), head('Loại đối tượng'), <ObjPicker key="obj" t={tState} smart={smart} sel={sel} setSmart={setSmart} />);
    }
    const raw = Object.keys(RAW_FIELD).filter(k => tState[k] != null);
    if (raw.length) {
      els.push(sep(), head('Chỉ sửa được trên web box'));
      els.push(
        <div className="zone-none" key="raw">
          {raw.map(k => RAW_FIELD[k]).join(' · ')} — giữ nguyên giá trị hiện tại khi lưu.
        </div>,
      );
    }
    if (!els.length) return <div className="zone-none">Thuật toán này không có tham số nào ngoài vùng vẽ</div>;
    return <div>{els}</div>;
  };

  /* ---- lịch canh phòng ---- */
  const loadSched = async () => {
    if (!ch || !sel) return;
    try {
      const d = await post('control/time/get', {channel_id: ch, algo_model: sel});
      setSched(schedToCells(d));
    } catch {
      setSched(schedToCells(null));
    }
  };
  const paneSched = () => {
    if (!sched) {
      loadSched();
      return <div className="zone-none">Đang đọc lịch từ box…</div>;
    }
    const cells = sched;
    const toggle = (k, tState) => {
      const next = {...cells, [k]: cells[k].slice()};
      next[k][tState] = !next[k][tState];
      setSched(next);
    };
    return (
      <div>
        <div className="sc-tools">
          <span className="cfg-h" style={{margin: 0}}>Mẫu sẵn</span>
          {SC_PRESETS.map(([nm, fn]) => (
            <button key={nm} className="sc-preset" onClick={() => {
              const next = {...cells};
              for (const [k] of DAYS) next[k] = fn();
              setSched(next);
            }}>{nm}</button>
          ))}
        </div>
        <div className="sc-grid">
          <div className="sc-axis">
            <span></span>
            <div className="hh">{Array.from({length: 13}, (_, i) => <span key={i}>{i * 2}</span>)}</div>
          </div>
          {DAYS.map(([key, label]) => (
            <div className="sc-row" key={key}>
              <button className="sc-day" title="Bấm để bật/tắt cả ngày" onClick={() => {
                const all = cells[key].every(Boolean);
                const next = {...cells, [key]: Array(SLOTS).fill(!all)};
                setSched(next);
              }}>{label}</button>
              <div className="sc-cells">
                {cells[key].map((on, tState) => (
                  <span key={tState} className={'sc-cell' + (on ? ' on' : '')}
                    title={`${label} ${HH(tState)}–${HH(tState + 1)}`}
                    onClick={() => toggle(key, tState)} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sc-sum">
          Bấm ô để bật/tắt từng giờ · bấm tên thứ để chọn cả ngày. Lịch áp riêng cho từng thuật toán.
        </div>
      </div>
    );
  };

  /* ---- liên kết hành động ---- */
  const loadLink = async () => {
    if (!ch || !sel) return;
    try {
      const d = await post('linkage/get', {channel_id: ch, algo_model: sel});
      setLink(d.linkage || {});
    } catch {
      setLink({});
    }
    try {
      const w = await post('linkage/web/get');
      setWeb((w.linkage_web_cfg || []).find(x => x.channel_id === ch) || {});
    } catch { /* giữ */ }
  };
  const paneLink = () => {
    if (!link) {
      loadLink();
      return <div className="zone-none">Đang đọc liên kết từ box…</div>;
    }
    const L = link;
    const snd = L.sound_linkage || {};
    const setField = (key, val) => {
      const next = {...L, [key]: val};
      setLink(next);
    };
    const setSnd = (key, val) => {
      const next = {...L, sound_linkage: {...snd, [key]: val}};
      setLink(next);
    };
    const setWebField = (key, val) => {
      const next = {...web, [key]: val};
      setWeb(next);
    };
    return (
      <div>
        {head('Cổng báo động của box')}
        <div className="cfg-rows">
          {(L.output || []).map(o => (
            <SwRow key={o.ID} label={'Cổng ra ' + o.ID} meta={'relay ' + o.ID}
              on={!!o.Enable} onChange={on => { o.Enable = on ? 1 : 0; setLink({...L}); }} />
          ))}
        </div>
        {sep()}
        {head('Loa cảnh báo')}
        <div className="cfg-rows">
          <SwRow label="Phát loa trên box" meta="loa gắn ở AI box" on={!!snd.enable}
            onChange={on => setSnd('enable', on ? 1 : 0)} />
          <SwRow label="Phát loa trên camera" meta="loa gắn ở camera" on={!!snd.ipc_enable}
            onChange={on => setSnd('ipc_enable', on ? 1 : 0)} />
          <CfgRow label="Âm lượng" hint="0 – 10">
            <Spin val={snd.volume ?? 8} lo={0} hi={10} step={1} onChange={v => setSnd('volume', v)} />
          </CfgRow>
          <CfgRow label="Số lần phát lại" hint="mỗi lần cảnh báo">
            <Spin val={snd.warn_cnt ?? 1} lo={1} hi={10} step={1} onChange={v => setSnd('warn_cnt', v)} />
          </CfgRow>
        </div>
        {sep()}
        {head('Thông báo trên máy này')}
        <div className="cfg-rows">
          <SwRow label="Hiện popup cảnh báo" meta="góc dưới trái màn hình"
            on={web.popup_enable !== 0} onChange={on => setWebField('popup_enable', on ? 1 : 0)} />
          <SwRow label="Đọc tiếng cảnh báo" meta="giọng nói trên trình duyệt"
            on={web.voice_enable === 1} onChange={on => setWebField('voice_enable', on ? 1 : 0)} />
        </div>
      </div>
    );
  };

  /* ---- pane theo tab ---- */
  const pane = tab === 'sched' ? paneSched() : tab === 'link' ? paneLink() : paneRule();

  /* ---- danh sách vùng đã vẽ ---- */
  const tState = smart.find(x => x.algo_model === sel) || null;
  const graphs = tState?.graphs || [];
  const zones = [];
  if (!sel) {
    zones.push(<div key="z" className="zone-none">Chọn một thuật toán ở trên để xem vùng phát hiện</div>);
  } else if (!graphs.length && !(mode === 'draw' && (pts.length || done.length))) {
    zones.push(<div key="z" className="zone-none">Chưa có vùng nào · bấm "Vẽ vùng" rồi bấm lên ảnh</div>);
  } else {
    graphs.forEach((g, i) => {
      const ps = parsePts(g.polygon || g.line);
      const row = (
        <div key={'g' + i} className={'zone' + (pick === i ? ' on' : '')}
          onClick={() => { setPick(pick === i ? null : i); }}>
          <span className="sw" style={{background: zoneColor(i)}}></span>
          <span className="nm">Vùng {i + 1}</span>
          <span className="mt">{ps.length} điểm · {(g.graph_usage === 'NotROI' ? 'vùng che' : 'vùng phân tích')}</span>
          <div className="grow"></div>
          <button className="act" onClick={e => { e.stopPropagation(); editZone(i); }}>Sửa</button>
          <button className="act rm" onClick={e => { e.stopPropagation(); delZone(i); }}>Xóa</button>
        </div>
      );
      zones.push(row);
    });
    if (mode === 'draw' && (pts.length || done.length)) {
      zones.push(
        <div key="drawing" className="zone">
          <span className="sw" style={{background: zoneColor(graphs.length)}}></span>
          <span className="nm">Vùng {graphs.length + 1}</span>
          <span className="mt">{pts.length} điểm · đang vẽ</span>
          <div className="grow"></div>
          <button className="act rm" onClick={() => { setPts([]); setDone([]); }}>Bỏ</button>
        </div>,
      );
    }
  }

  const editZone = i => {
    const g = graphs[i];
    setMode('draw'); setPick(null);
    setUsage(g.graph_usage === 'NotROI' ? 'NotROI' : 'ROI');
    const st = stepsOf(sel, g.graph_usage === 'NotROI' ? 'NotROI' : 'ROI')
      .map(x => ({key: x.key, pts: parsePts(g[x.key])}))
      .filter(x => x.pts.length);
    setDone(st.slice(0, -1));
    setPts(st.length ? st[st.length - 1].pts : []);
    const ns = smart.slice();
    const tt = ns.find(x => x.algo_model === sel);
    tt.graphs = graphs.filter((_, k) => k !== i);
    setSmart(ns);
  };
  const delZone = i => {
    const ns = smart.slice();
    const tt = ns.find(x => x.algo_model === sel);
    tt.graphs = graphs.filter((_, k) => k !== i);
    setSmart(ns);
    setPick(null);
  };

  /* ---- chọn thuật toán (fn-tab) ---- */
  const pickAlgo = m => {
    setSel(m);
    setPts([]); setDone([]); setMode('idle'); setPick(null);
    setSched(null); setLink(null);
  };

  /* ---- xoá thuật toán ---- */
  const removeAlgo = m => {
    setConfirm({
      title: 'Xóa thuật toán',
      msg: `Xóa "${algoName(t, m)}" khỏi ${name}?`,
      sub: 'Vùng phát hiện, lịch canh phòng và liên kết của thuật toán này sẽ mất.',
      yes: 'Xóa',
      onYes: async () => {
        const keep = smart.filter(x => x.algo_model !== m);
        try {
          if (keep.length) await post('smart/task', {channel_id: ch, status: 1});
          await post('smart/update', {channel_id: ch, smart_list: keep.map(stripTask)});
          if (!keep.length) await post('smart/task', {channel_id: ch, status: 0});
          setSmart(keep);
          if (sel === m) setSel(keep[0]?.algo_model || null);
          setPts([]); setSched(null); setLink(null);
          loadCap(ch, keep.map(x => x.algo_model));
        } catch (e) {
          alert(e.message);
        }
      },
    });
  };
  const stripTask = tState => { const {person_control_info, ...rest} = tState; return rest; };

  /* ---- nạp thuật toán (picker) ---- */
  const openPicker = () => {
    if (!loaded.length) return;
    setFpSel(new Set(smart.map(tState => tState.algo_model)));
    setFpCap(null); setFpOver(false); setPicker(true);
    refreshCap(new Set(smart.map(tState => tState.algo_model)));
  };
  const refreshCap = async selSet => {
    if (fpBusy) return;
    setFpBusy(true);
    try {
      const r = await fetch(BASE + 'api/hashrate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({channel_id: ch, algo_model: [...selSet]}),
      }).then(x => x.json());
      const v = r?.data?.hashrate;
      setFpCap(v != null ? v : null);
      setFpOver(r?.status_code === 52040 || (v != null && v <= 0));
    } catch { setFpCap(null); } finally {
      setFpBusy(false);
    }
  };
  const toggleFp = m => {
    const next = new Set(fpSel);
    if (next.has(m)) next.delete(m);
    else if (fpOver) return;
    else next.add(m);
    setFpSel(next);
    refreshCap(next);
  };
  const savePicker = async () => {
    const want = [...fpSel];
    const cur = smart.map(tState => tState.algo_model);
    const add = want.filter(m => !cur.includes(m));
    const del = cur.filter(m => !want.includes(m));
    if (!add.length && !del.length) { setPicker(false); return; }
    if (del.length) {
      setConfirm({
        title: 'Xóa thuật toán',
        msg: `Bỏ ${del.length} thuật toán khỏi ${name}: ${del.map(m => algoName(t, m)).join(', ')}`,
        sub: 'Vùng phát hiện, lịch canh phòng và liên kết của các thuật toán này sẽ mất.',
        yes: 'Xóa',
        onYes: () => doSavePicker(add, del, want),
      });
      return;
    }
    doSavePicker(add, del, want);
  };
  const doSavePicker = async (add, del, want) => {
    setFpLoading(true);
    try {
      const kept = smart.filter(tState => want.includes(tState.algo_model));
      const fresh = add.map(m => {
        const d = (defs || []).find(x => x.algo_model === m);
        return d ? JSON.parse(JSON.stringify(d)) : {algo_model: m, graphs: []};
      });
      const ns = [...kept, ...fresh];
      if (ns.length) await post('smart/task', {channel_id: ch, status: 1});
      await post('smart/update', {channel_id: ch, smart_list: ns.map(stripTask)});
      if (!ns.length) await post('smart/task', {channel_id: ch, status: 0});
      setSmart(ns);
      if (!ns.some(t2 => t2.algo_model === sel)) setSel(ns[0]?.algo_model || null);
      setPts([]); setSched(null); setLink(null);
      setPicker(false);
      loadCap(ch, ns.map(x => x.algo_model));
    } catch (e) {
      alert(e.message);
    } finally {
      setFpLoading(false);
    }
  };

  /* ---- lưu cấu hình ---- */
  const save = async () => {
    setSaving(true);
    try {
      const ns = smart.slice();
      if (sel) {
        const tt = ns.find(x => x.algo_model === sel);
        if (tt) {
          const all = stepsOf(sel, usage);
          const s = all[done.length] || null;
          let dd = done.slice();
          if (s && pts.length >= s.min) dd = [...dd, {key: s.key, pts: pts.slice()}];
          else if (s && pts.length) throw new Error(`${s.label} cần ít nhất ${s.min} điểm (đang có ${pts.length})`);
          const need = stepsOf(sel, usage);
          if (dd.length && dd.length < need.length)
            throw new Error(`${algoName(t, sel)} cần vẽ đủ ${need.length} bước: ${need.map(x => x.label).join(' → ')}`);
          if (dd.length) tt.graphs = graphsFrom(sel, dd, usage);
        }
      }
      if (ns.length) await post('smart/task', {channel_id: ch, status: 1});
      await post('smart/update', {channel_id: ch, smart_list: ns.map(stripTask)});
      if (!ns.length) await post('smart/task', {channel_id: ch, status: 0});
      setSmart(ns);
      setPts([]); setDone([]); setMode('idle');
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ---- nút Vẽ vùng ---- */
  const toggleDraw = () => {
    if (!sel) return;
    if (mode === 'draw') { setMode('idle'); setPts([]); setDone([]); setHover(null); }
    else { setMode('draw'); setPick(null); }
  };
  const clearAll = () => {
    setPts([]); setDone([]);
    if (tState) {
      const ns = smart.slice();
      const tt = ns.find(x => x.algo_model === sel);
      tt.graphs = [];
      setSmart(ns);
    }
  };

  /* ---- quay lại tab Camera (view này luôn mở cho 1 camera cụ thể) ---- */
  const backToList = () => go?.('cam');

  return (
    <section className="view" id="v-ai" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
      <div className="view-wrap" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, boxSizing: 'border-box', overflow: 'hidden'}}>
        <div className="bar" style={{flex: 'none', gap: 12, flexWrap: 'wrap'}}>
          <button data-glassbtn onClick={backToList} style={{height: 36, padding: '0 14px'}}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {t('ai.camListBtn')}
          </button>
          <div style={{display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0}}>
            <span className="view-h2"><span>{t('ai.configTitle')}</span> · <span id="aiTitle">{name || '—'}</span></span>
            <span className="view-sub" id="aiStream" style={{fontSize: 11}}>
              {name ? 'channel ' + ch + ' · ' + name : '—'}
            </span>
          </div>
          <div className="grow"></div>
          <div data-glass className="cap" style={{borderRadius: 14}}>
            <span className="cap-k">{t('cam.remainingPower')}</span>
            <span className="cap-v" id="aiHr"
              style={cap == null ? undefined : {color: cap < 15 ? 'var(--err2)' : cap < 40 ? 'var(--warn)' : 'var(--ok)'}}>
              {cap != null ? cap + '%' : '—'}
            </span>
            <div className="cap-bar"><i className={cap == null ? '' : cap < 15 ? 'err' : cap < 40 ? 'warn' : ''}
              style={{width: (cap == null ? 0 : cap) + '%'}} /></div>
          </div>
          <button data-glassbtn style={{height: 36, padding: '0 15px'}} onClick={backToList}>{t('common.cancel')}</button>
          <button data-goldbtn style={{height: 36, padding: '0 18px'}} disabled={saving} onClick={save}>
            {saving ? t('cam.saving') : t('common.saveConfig')}
          </button>
        </div>

        {!ch && <div className="zone-none">{t('ai.noCamSelected')}</div>}

        {/* ---- phần cấu hình AI (chỉ khi đã chọn camera) ---- */}
        {ch && (
          <div className="ai-wrap nosb" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0, gap: 10, overflow: 'hidden'}}>
            <div data-glass className="fn-tabs" id="aiFns"
              style={{flex: 'none', borderRadius: 16, padding: 8, marginBottom: 0}}>
              {smart.length === 0 && <span className="fn-none">Camera này chưa bật thuật toán nào</span>}
              {smart.map(t2 => {
                const m = t2.algo_model;
                return (
                  <button key={m} className={'fn-tab' + (sel === m ? ' on' : '')}
                    onClick={() => pickAlgo(m)} title={m}>
                    <span className="d"></span>
                    <span className="l">{algoName(t, m)}</span>
                    <span className="x" onClick={ev => { ev.stopPropagation(); removeAlgo(m); }}>&#10005;</span>
                  </button>
                );
              })}
              <div className="fn-add" onClick={ev => { ev.stopPropagation(); openPicker(); }}>
                <span className="p">+</span><span className="t">{t('ai.addAiFunc')}</span>
              </div>
            </div>

            <div data-aicols className="ai-cols"
              style={{flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 12, alignItems: 'stretch', overflow: 'hidden'}}>
              <div className="ai-left" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden'}}>
                <div data-glass className="ai-tools" style={{flex: 'none', borderRadius: 14, padding: '8px 12px', gap: 9}}>
                  <button data-goldbtn onClick={toggleDraw} style={{height: 34, padding: '0 14px'}}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#2a2410" strokeWidth="1.9"
                      strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
                      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3M14.5 6.5l3 3" />
                    </svg>
                    {mode === 'draw' ? t('ai.drawingStop') : t('ai.drawArea')}
                  </button>
                  <button data-glassbtn onClick={clearAll} style={{height: 34, padding: '0 13px'}}>{t('ai.clearAllAreas')}</button>
                  <div className="grow"></div>
                  <span className="hint" style={{textAlign: 'right', color: hintColor}}>{hintText}</span>
                </div>

                <div className="ai-shot" id="aiStage" data-roi data-drawing={mode === 'draw' ? 'on' : 'off'}
                  style={{width: '100%', aspectRatio: '16/9', position: 'relative'}}>
                  <div id="aiShot" ref={shotRef}>
                    <div ref={streamWrapRef} style={{position: 'absolute', inset: 0}} />
                  </div>
                  <canvas id="aiCv" ref={cvRef}
                    onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
                    onMouseLeave={onMouseLeave} onClick={onCanvasClick} onContextMenu={onContextMenu} />
                  <div data-roigrid></div>
                  <div className="ai-shot-top">
                    <span className="ai-dot"></span>
                    <span className="ai-q" id="aiQual">—</span>
                  </div>
                </div>
              </div>

              <div className="ai-right" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden'}}>
                <div className="cfg-tabs" id="aiTabs"
                  style={{flex: 'none', alignSelf: 'flex-start', margin: '10px 12px 0', flexWrap: 'wrap'}}>
                  <button data-t="rule" className={tab === 'rule' ? 'on' : ''} onClick={() => setTab('rule')}>{t('ai.tabRule')}</button>
                  <button data-t="sched" className={tab === 'sched' ? 'on' : ''} onClick={() => setTab('sched')}>{t('ai.tabSched')}</button>
                  <button data-t="link" className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>{t('ai.tabLink')}</button>
                </div>
                <div className="cfg-pane nosb" id="aiPane" style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: 12}}>
                  {!sel
                    ? <div className="zone-none">Chọn một thuật toán để cấu hình</div>
                    : pane}
                </div>
              </div>
            </div>

            <div data-glass style={{flex: 'none', height: '11vh', minHeight: 70, maxHeight: 100, display: 'flex', flexDirection: 'column', borderRadius: 14, padding: '7px 12px', overflow: 'hidden'}}>
              <div style={{flex: 'none', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5, flexWrap: 'wrap'}}>
                <span className="card-h">{t('ai.detectionZone')}</span>
                <div className="grow"></div>
                <span style={{font: '400 10px/1 var(--b)', color: 'rgba(229,229,234,.38)', whiteSpace: 'nowrap'}}>
                  bấm vùng để chọn trên ảnh · Sửa / Xóa từng vùng
                </span>
              </div>
              <div className="zone-list nosb" id="aiZones" style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>{zones}</div>
            </div>
          </div>
        )}
      </div>

      {/* ---- MODAL · XÁC NHẬN (dùng chung, port cfWrap) ---- */}
      {confirm && createPortal((
        <div className="overlay" data-overlay onClick={() => setConfirm(null)}>
          <div className="modal" data-modal data-glass style={{width: 'min(440px,100%)', borderRadius: 22}}
            onClick={e => e.stopPropagation()}>
            <div className="m-head" style={{borderBottom: 'none', alignItems: 'center', padding: '17px 18px 0'}}>
              <span style={{flex: 'none', display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(180deg,rgba(255,88,78,.34),rgba(214,44,34,.16))',
                border: '1px solid rgba(255,69,58,.42)', boxShadow: '0 0 20px rgba(255,69,58,.24)'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#ff8a84" strokeWidth="1.9"
                  strokeLinecap="round" strokeLinejoin="round" style={{width: 17, height: 17}}>
                  <path d="M5 7h14M9.5 7V4.4h5V7M7 7l1 13h8l1-13" />
                </svg>
              </span>
              <span className="m-title" style={{flex: 1, minWidth: 0}}>{confirm.title || 'Xác nhận'}</span>
              <button className="m-x" data-mx onClick={() => setConfirm(null)}>✕</button>
            </div>
            <div style={{padding: '13px 18px 4px', display: 'flex', flexDirection: 'column', gap: 7}}>
              <span style={{font: '500 12.5px/1.55 var(--b)', color: 'rgba(245,245,247,.86)'}}>{confirm.msg}</span>
              <span className="hint">{confirm.sub}</span>
            </div>
            <div className="m-foot" style={{borderTop: 'none', justifyContent: 'flex-end', padding: '16px 18px 18px'}}>
              <button data-glassbtn style={{height: 36, padding: '0 16px'}} onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
              <button data-redbtn style={{height: 36, padding: '0 18px'}} onClick={() => {
                const fn = confirm.onYes;
                setConfirm(null);
                fn && fn();
              }}>{confirm.yes || t('common.delete')}</button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* ---- MODAL · NẠP THUẬT TOÁN CHO CAMERA (port fpWrap) ---- */}
      {picker && createPortal((
        <div className="overlay" data-overlay onClick={() => setPicker(false)}>
          <div className="modal" data-modal data-glass style={{width: 'min(780px,100%)'}} onClick={e => e.stopPropagation()}>
            <div className="m-head">
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5}}>
                <span className="m-title">{t('ai.loadAlgoTitle')} · <span id="fpCam">{name}</span></span>
                <span className="view-sub">Chỉ hiện thuật toán box đã nạp sẵn · algo/list/current</span>
              </div>
              <button className="m-x" data-mx aria-label={t('common.close')} onClick={() => setPicker(false)}>✕</button>
            </div>
            <div className="fp-cap">
              <span className="fp-cap-k">{t('cam.remainingPower')}</span>
              <span className={'fp-cap-v' + (fpOver ? ' err' : fpCap < 40 ? ' warn' : '')} id="fpHr">
                {fpCap != null ? fpCap + '%' : '—'}
              </span>
              <div className="fp-bar"><i id="fpBar"
                style={{width: Math.max(0, Math.min(100, fpCap ?? 0)) + '%'}}></i></div>
              <div className="grow"></div>
              <span className="hint" id="fpCnt">{fpSel.size}/{loaded.length} thuật toán đã chọn</span>
            </div>
            <div className="fp-body nosb" id="fpGrid" style={{gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))'}}>
              {loaded.map(m => {
                const on = fpSel.has(m);
                return (
                  <div key={m} className={'al-item' + (on ? ' on' : '') + (!on && fpOver ? ' dis' : '')}
                    title={m} onClick={() => toggleFp(m)}>
                    <span className="al-box"></span>
                    <span className="al-nm">{algoName(t, m)}</span>
                  </div>
                );
              })}
            </div>
            <div className="m-foot">
              <span className="hint" id="fpHint" style={{color: fpOver ? 'var(--err2)' : ''}}>
                {fpOver ? t('ai.pickerOverPower')
                  : t('ai.pickerHint')}
              </span>
              <div className="grow"></div>
              <button data-glassbtn onClick={() => setPicker(false)} style={{height: 36, padding: '0 16px'}}>{t('common.cancel')}</button>
              <button data-goldbtn disabled={fpLoading} onClick={savePicker} style={{height: 36, padding: '0 18px'}}>
                {fpLoading ? t('cam.addingToBox') : t('ai.loadAlgoBtn')}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </section>
  );
}

/* ---------------- ObjPicker: chọn loại đối tượng (rule pane) ---------------- */
function ObjPicker({t, smart, sel, setSmart}) {
  const [open, setOpen] = useState(false);
  const selSet = new Set(t?.object_type || []);
  const toggle = v => {
    const ns = smart.slice();
    const tt = ns.find(x => x.algo_model === sel);
    const s = new Set(selSet);
    s.has(v) ? s.delete(v) : s.add(v);
    tt.object_type = [...s].sort();
    setSmart(ns);
  };
  const on = OBJ_TYPES.filter(([v]) => selSet.has(v));
  return (
    <div className="obj-wrap">
      <div className={'obj-head' + (open ? ' open' : '')} onClick={e => { e.stopPropagation(); setOpen(!open); }}>
        {on.length === 0
          ? <span className="obj-chip none">Chưa chọn loại nào</span>
          : on.map(([, lb]) => <span key={lb} className="obj-chip">{lb}</span>)}
        <span className="obj-caret">{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="obj-menu" onClick={e => e.stopPropagation()}>
          {OBJ_TYPES.map(([v, lb]) => (
            <div key={v} className={'obj-item' + (selSet.has(v) ? ' on' : '')} onClick={e => { e.stopPropagation(); toggle(v); }}>
              <span className="obj-box"></span>
              <span className="l">{lb}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- sched helpers ---------------- */
const hOf = s => {
  const [h, m] = String(s || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
};
const schedToCells = d => Object.fromEntries(DAYS.map(([k]) => [k,
  Array.from({length: SLOTS}, (_, t) =>
    (d?.[k] || []).some(r => hOf(r.start) <= t / 2 && hOf(r.end) >= (t + 1) / 2))]));