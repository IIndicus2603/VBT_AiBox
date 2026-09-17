import React, {Fragment, useCallback, useEffect, useMemo, useState} from 'react';
import {BASE, pad, absUrl, imgOf, videoOf} from '../api/client.js';
import useEvents from '../api/useEvents.js';

/**
 * NHẬT KÝ — port của ui.js paintAlarms()/paintLogFilter()/tlRow() (677-1001)
 * + helpers trong ai.js (algoName/algoGroups/camOf/imgOf/videoOf/isDetect...).
 *
 * Giữ nguyên cấu trúc markup từ index.html #v-log (300-334): thanh bar với bộ lọc
 * dropdown (#logFilter/#logFilterMenu/#logFilterList), nút Làm mới (#logRefresh),
 * nút "Đã xem" (#logReadAll), và #logBox chứa .tl-day + .tl do paintAlarms sinh.
 * Dùng đúng class CSS từ style.css — không thêm CSS mới.
 *
 * Dữ liệu: POST /api/alarms (lịch sử) + SSE /events (cảnh báo mới).
 */

/* ---------- bảng dịch + nhóm, port từ ai.js ---------- */

// KIND_COLOR (ui.js:681) — mốc màu theo nhóm thuật toán, key khớp ALGO_CAT.
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

// ALGO_VI (ai.js:80-179) — tên hiển thị cho algo_model (box chỉ trả mã kỹ thuật).
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
  AbnormalParkingDetection_HighSpeedEvent: 'Đỗ xe bất thường (giao thông)',
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
  BareSoilCoverDetection: 'Đất trống chưa phủ',
  DisorderStackingDetection: 'Xếp vật liệu sai',
  TrashOverflowingDetection: 'Thùng rác tràn',
  ExposedGarbageDetection: 'Rác lộ thiên',
  PackedGarbageDetection: 'Rác đóng túi',
  ShirtlessDetection: 'Không mặc áo',
  ChefHatAlarm: 'Không mũ đầu bếp',
  ChefClothesDetection: 'Không đồng phục đầu bếp',
  SafetyHarnessDetection: 'Không dây an toàn',
  ClimbingDetectionAlarm: 'Trèo leo',
  PeopleGathering: 'Tụ tập',
  FastMoving: 'Di chuyển nhanh',
  StayAloneDetection: 'Thiếu người trực',
  KnifeStickDetection: 'Cầm dao / gậy',
  UnwashedVehicleDetection: 'Xe chưa rửa',
  VehicleOverspeedDetection: 'Xe quá tốc độ',
  ForkliftOverspeedDetection: 'Xe nâng quá tốc độ',
  NoSafetyBeltDetection: 'Không thắt dây an toàn',
  PresetMarkerDetection: 'Mốc định sẵn',
  GasCylinderDetection: 'Bình gas',
  ChargingGunNotinPlace: 'Súng sạc không đúng chỗ',
  NoFireExtinguisherDetection: 'Thiếu bình chữa cháy',
  DumpTruckWithoutTarp: 'Xe ben không phủ bạt',
  OilLeakDetection: 'Rò dầu',
  GasLeakDetection: 'Rò khí',
  LiquidLeakDetection: 'Rò nước',
  TestPaperColorChangeDetection: 'Giấy thử đổi màu',
  NoSafetyGogglesDetection: 'Không kính bảo hộ',
  NoSafetyGlovesDetection: 'Không găng tay',
  NoDustGasMaskDetection: 'Không mặt nạ phòng độc',
  ExposedLongHairDetection: 'Tóc dài không buộc',
  CampusEntranceExitLPC: 'Biển số ra vào khu',
  CampusVehicleCongestionDetection: 'Ùn xe trong khu',
  DogDetection: 'Chó',
  FuelUnloadDetect: 'Xả dầu',
  Construction: 'Thi công đường',
  ThrowingEvent: 'Ném rác',
  TrafficAccident: 'Tai nạn giao thông',
  DriveSlowly: 'Xe chạy quá chậm',
  DriveAway: 'Xe rời đi',
  Fogging: 'Sương mù',
  NonMotorVehicleIntrusionDetection: 'Xe 2 bánh xâm nhập',
  OccupancyEmergencyLane: 'Chiếm làn khẩn cấp',
  Pedestrian: 'Người đi bộ xâm nhập',
  Retrograde: 'Xe đi ngược chiều',
  SnowCover: 'Tuyết phủ mặt đường',
  Congestion: 'Ùn tắc',
  VehicleEnterExitServiceStation: 'Xe ra vào trạm',
  ForkliftDetection: 'Xe nâng',
  EngineeringVehicleDetection: 'Xe công trình',
  IllegalAdditionOfBulkGasoline: 'Bơm xăng trái phép',
  WildlifeIntrusionDetection: 'Động vật xâm nhập',
  FireOperationUnattended: 'Hàn cắt không người trông',
  SmokeAndFireDetectionEvent: 'Khói và lửa',
  RestrictedAreaFishingDetection: 'Đánh bắt khu cấm',
  WaterOutletDischargeDetection: 'Xả thải cửa nước',
  HandDetection: 'Bàn tay',
  FreightInPassengerElevator: 'Chở hàng trong thang khách',
  ElectricBicycleIntrusionDetection: 'Chở hàng trong thang khách',
  LongQueueDetection: 'Xếp hàng dài',
  LightsLeftOnDetection: 'Quên tắt đèn',
  PedestrianAntiDirectionDetection: 'Người đi ngược chiều',
  ReverseMotionOnEscalator: 'Đi ngược thang cuốn',
  GunmanDetection: 'Súng',
  ShipDetection: 'Tàu thuyền',
  SurfaceWaterDetection: 'Ngập nước mặt đường',
  TrafficParameters: 'Thông số giao thông',
  TrafficParameter: 'Thông số giao thông',
};

// ALGO_CAT (ai.js:195-227) — nhóm cho từng algo_model, theo đúng thứ tự box.
const ALGO_CAT = {
  'Chức năng chung': ['ObjectIsRecognized', 'FieldDetectorObjectsInside', 'LineDetectorCrossed',
    'EnterArea', 'LeaveArea', 'AreaRuleData', 'CrowdDensityCriticalAlarm', 'LineRuleData',
    'PresetMarkerDetection'],
  'Môi trường': ['FireDetection', 'FumesAlarmBegin', 'ChannelBlockageDetection', 'ObjectRemoved',
    'UncoveredTrashCanDetection', 'MouseDetect', 'BareSoilCoverDetection', 'DisorderStackingDetection',
    'TrashOverflowingDetection', 'ExposedGarbageDetection', 'DogDetection', 'PackedGarbageDetection',
    'ChargingGunNotinPlace', 'NoFireExtinguisherDetection', 'DumpTruckWithoutTarp', 'OilLeakDetection',
    'LiquidLeakDetection', 'GasLeakDetection', 'TestPaperColorChangeDetection',
    'IllegalAdditionOfBulkGasoline', 'FireOperationUnattended', 'SurfaceWaterDetection',
    'WildlifeIntrusionDetection', 'FreightInPassengerElevator', 'LightsLeftOnDetection',
    'LongQueueDetection', 'AccessElevatorAlarm', 'ElectricBicycleIntrusionDetection',
    'FuelUnloadDetect'],
  'Bảo hộ lao động (PPE)': ['SafetyHelmetAlarm', 'WorkClothesAlarm', 'ReflectiveClothesDetectionAlarm',
    'NoMaskAlarm', 'ShirtlessDetection', 'ChefClothesDetection', 'ChefHatAlarm',
    'SafetyHarnessDetection', 'NoSafetyBeltDetection', 'NoSafetyGogglesDetection',
    'NoSafetyGlovesDetection', 'NoDustGasMaskDetection', 'ExposedLongHairDetection'],
  'Hành vi': ['SleepingDetectionAlarm', 'OffDutyDetectionAlarm', 'SmokingAlarm', 'TelephoningAlarm',
    'PlayMobilePhoneDetection', 'FallOverAlarm', 'ClimbingDetectionAlarm', 'LongStayDetection',
    'FightDetectionAlarm', 'PeopleGathering', 'FastMoving', 'StayAloneDetection',
    'KnifeStickDetection', 'HandDetection', 'PedestrianAntiDirectionDetection',
    'ReverseMotionOnEscalator', 'GunmanDetection'],
  'Phương tiện': ['AbnormalParkingDetection', 'UnwashedVehicleDetection',
    'NonMotorAbnormalParkingDetection', 'VehicleOverspeedDetection', 'ForkliftOverspeedDetection',
    'ForkliftDetection', 'EngineeringVehicleDetection', 'VehicleEnterExitServiceStation',
    'CampusEntranceExitLPC', 'CampusVehicleCongestionDetection'],
  'Sự kiện đường cao tốc': ['ThrowingEvent', 'TrafficAccident', 'DriveSlowly', 'DriveAway', 'Fogging',
    'AbnormalParkingDetection_HighSpeedEvent', 'NonMotorVehicleIntrusionDetection',
    'OccupancyEmergencyLane', 'Pedestrian', 'Retrograde', 'SnowCover', 'Congestion', 'Construction',
    'TrafficParameters', 'SmokeAndFireDetectionEvent', 'TrafficParameter'],
  'Thuỷ lợi / Quản lý đô thị': ['WaterOutletDischargeDetection', 'ShipDetection'],
  'AlertFree': ['GasCylinderDetection', 'RestrictedAreaFishingDetection'],
};

const CAT_OF = Object.fromEntries(
  Object.entries(ALGO_CAT).flatMap(([c, ms]) => ms.map(m => [m, c])));

/** Gom danh sách algo_model thành [{cat, models}] theo thứ tự ALGO_CAT. */
function algoGroups(models) {
  const has = new Set(models);
  const out = Object.entries(ALGO_CAT)
    .map(([cat, ms]) => ({cat, models: ms.filter(m => has.has(m))}))
    .filter(g => g.models.length);
  const rest = models.filter(m => !CAT_OF[m]);
  if (rest.length) out.push({cat: 'Khác', models: rest});
  return out;
}

const algoName = (m, fromBox) => fromBox || ALGO_VI[m] || m;

/* ---------- helpers alarm, port từ ai.js ---------- */

const camOf = a => (a?.channel_id != null ? 'ch' + a.channel_id : null);
const camKey = a => camOf(a) || '?';
const algoKey = a => a?.algo_model || '?';

// type 2/6/7 = Alarm Recovery / keep-alive / đổi trạng thái channel; kind 'sse'
// hoặc AreaRuleData — không phải phát hiện, bỏ khỏi nhật ký.
const isDetect = a => a?.type != null
  && a.type !== 2 && a.type !== 6 && a.type !== 7
  && a?.kind !== 'sse' && a?.algo_model !== 'AreaRuleData';

const logMatch = (a, cams, algos) =>
  (!cams || cams.has(camKey(a))) && (!algos || algos.has(algoKey(a)));


/** Bat/tat 1 muc loc. allKeys = toàn bộ mục đang có. */
function toggleIn(sel, key, allKeys) {
  const s = new Set(sel || allKeys);
  if (s.has(key)) s.delete(key); else s.add(key);
  return (s.size === 0 || s.size === allKeys.length) ? null : s;
}

/** Nhãn nút Lọc: chọn đúng 1 mục thì hiện tên, còn lại đếm. */
function logFilterLabel(logCams, logAlgos, cams, byCat) {
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

/* ================= component ================= */

export default function LogView({onOpen, onReadAll, onSeen, onClip}) {
  const [alarms, setAlarms] = useState([]);      // AL (đã lọc isDetect)
  const [loaded, setLoaded] = useState(false);
  const [logCams, setLogCams] = useState(null);  // Set camKey
  const [logAlgos, setLogAlgos] = useState(null); // Set algoKey
  const [menuOpen, setMenuOpen] = useState(false);
  const [cleared, setCleared] = useState(() => new Set()); // camera đã "Bỏ qua"

  // Nạp lịch sử từ alarms.jsonl (POST /api/alarms) — port loadAlarmHistory().
  const refresh = useCallback(async () => {
    try {
      const j = await fetch(BASE + 'api/alarms', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
      }).then(r => r.json());
      if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
      const arr = (j.data || []).filter(isDetect).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      setAlarms(arr.slice(0, 300));
    } catch (e) {
      console.warn('loadAlarmHistory:', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Đóng menu lọc khi click ra ngoài (giống ui.js document click listener) và
  // khi cuộn trang (panel FIXED gắn vào nút — cuộn thì đóng để không trôi nổi).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuOpen]);

  // SSE /events — thêm cảnh báo mới vào danh sách. "MỚI" không đánh dấu ở đây:
  // nó đọc alarm.seen do backend ghi (Mongo), nên giữ nguyên qua refresh tới khi
  // bấm "Đã xem" hoặc bấm vào xem đúng cảnh báo đó.
  const onEvent = useCallback(ev => {
    if (!ev || typeof ev !== 'object') return;
    setAlarms(prev => {
      const next = (isDetect(ev) ? [...prev, ev] : [...prev])
        .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 300);
      return next;
    });
  }, []);
  useEvents(onEvent);

  // Dọn bộ lọc mỗi khi danh sách alarm đổi (giống paintAlarms): bỏ mục không còn
  // xuất hiện, chọn hết thì về null để cảnh báo "MỚI" tự hiện lại.
  useEffect(() => {
    const all = alarms.filter(isDetect);
    const camKeys = new Set(all.map(camKey));
    const algoKeys = new Set(all.map(algoKey));
    setLogCams(c => {
      if (!c) return c;
      const nc = new Set([...c].filter(k => camKeys.has(k)));
      return (nc.size === 0 || nc.size === camKeys.size) ? null : nc;
    });
    setLogAlgos(a => {
      if (!a) return a;
      const na = new Set([...a].filter(k => algoKeys.has(k)));
      return (na.size === 0 || na.size === algoKeys.size) ? null : na;
    });
  }, [alarms]);

  // rows đã lọc + giới hạn 150 (paintAlarms).
  const rows = useMemo(() => {
    const all = alarms.filter(isDetect);
    return all.filter(a => logMatch(a, logCams, logAlgos)).slice(0, 150);
  }, [alarms, logCams, logAlgos]);

  // Phần nhóm lọc — gom từ chính dữ liệu đang có (paintLogFilter).
  const {cams, byCat, camAll, algoAll} = useMemo(() => {
    const all = alarms.filter(isDetect);
    const c = new Map();
    const b = new Map();
    for (const a of all) {
      const ck = camKey(a);
      const ce = c.get(ck);
      if (ce) ce.n++;
      else c.set(ck, {label: ck === '?' ? 'Không rõ' : (a.channel_name || ck), n: 1});
      const cat = algoGroups([a.algo_model])[0]?.cat || 'Khác';
      const ak = algoKey(a);
      let m = b.get(cat);
      if (!m) b.set(cat, m = new Map());
      const ae = m.get(ak);
      if (ae) ae.n++;
      else m.set(ak, {label: ak === '?' ? 'Không rõ' : algoName(a.algo_model, a.algo_name), n: 1});
    }
    return {
      cams: c,
      byCat: b,
      camAll: [...c.keys()],
      algoAll: [...b.values()].flatMap(m => [...m.keys()]),
    };
  }, [alarms]);

  const inc = (sel, k) => !sel || sel.has(k);

  // "Đã xem" — xóa badge "MỚI" toàn app (App reset unread -> tl-new biến mất).
  const readAll = () => onReadAll?.();

  // "Bỏ qua" trên thẻ — port clearAlarm(cam) cục bộ (xóa hiệu ứng lần phát hiện).
  const skipAlarm = (e, cam) => {
    e.stopPropagation();
    if (!cam) return;
    setCleared(c => { const n = new Set(c); n.add(cam); return n; });
  };

  const chNum = k => (k === '?' ? 1e9 : (parseInt(k.slice(2), 10) || 0));

  // Dòng tiêu đề ngày — chỉ hiện nếu có dữ liệu.
  const d0 = rows[0]?.ts ? new Date(rows[0].ts * 1000) : null;

  const label = logFilterLabel(logCams, logAlgos, cams, byCat);

  return (
    <section className="view" id="v-log">
      <div className="view-wrap" style={{overflow: 'hidden'}}>
        {/* Frame chứa danh sách nhật ký + thanh bộ lọc & nút Đã xem */}
        <div data-glass className="nosb" style={{borderRadius: 20, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
          {/* Thanh công cụ: Ngày bên trái, Nút Lọc và nút Đã xem bên phải */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.18)'
          }}>
            <div className="tl-day" style={{padding: 0, margin: 0, flex: 1, minWidth: 0}}>
              <span className="d">{d0 ? 'Hôm nay · ' + pad(d0.getDate()) + '/' + pad(d0.getMonth() + 1) : ''}</span>
              <div className="ln" />
            </div>

            <div style={{display: 'flex', alignItems: 'center', gap: 10, flex: 'none'}}>
              <div className="drop" id="logFilterDrop" style={{position: 'relative', flex: 'none', display: 'flex'}}>
                <button data-goldbtn id="logFilter" style={{height: 36, padding: '0 14px', borderRadius: 10}}
                        onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d="M4 6h16M7 12h10M10 18h4"/></svg>
                  <span id="logFilterLabel">{label}</span>
                </button>
                {menuOpen && (
                  <div className="menu" id="logFilterMenu" data-glass onClick={e => e.stopPropagation()}
                       style={{top: 'calc(100% + 8px)', right: 0, minWidth: 220, borderRadius: 14, background: 'linear-gradient(180deg,rgba(20,24,32,.95),rgba(12,15,20,.95))', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 16px 34px rgba(0,0,0,.6)', position: 'absolute', zIndex: 100}}>
                    <div id="logFilterList">
                      <div className="msec">Camera</div>
                      {[...cams.keys()].sort((x, y) => chNum(x) - chNum(y)).map(k => {
                        const c = cams.get(k);
                        return <FilterRow key={'c' + k} cls={inc(logCams, k) ? 'on' : ''}
                          label={c.label} n={c.n} color={KIND_COLOR['Khác']}
                          onClick={() => setLogCams(toggleIn(logCams, k, camAll))} />;
                      })}
                      <div className="msep" />
                      <div className="msec">Hành vi</div>
                      {[...byCat.keys()].sort().map(cat => {
                        const m = byCat.get(cat), keys = [...m.keys()];
                        const color = KIND_COLOR[cat] || KIND_COLOR['Khác'];
                        const total = [...m.values()].reduce((sum, x) => sum + x.n, 0);
                        const on = keys.every(k => inc(logAlgos, k));
                        return (
                          <Fragment key={'g' + cat}>
                            <FilterRow cls={on ? 'on' : ''} label={cat} n={total} color={color}
                              onClick={() => {
                                const s = new Set(logAlgos || algoAll);
                                keys.forEach(k => { if (on) s.delete(k); else s.add(k); });
                                setLogAlgos((s.size === 0 || s.size === algoAll.length) ? null : s);
                              }} />
                            {keys.map(k => {
                              const e = m.get(k);
                              return <FilterRow key={cat + k} cls={'sub' + (inc(logAlgos, k) ? ' on' : '')}
                                label={e.label} n={e.n} color={color}
                                onClick={() => setLogAlgos(toggleIn(logAlgos, k, algoAll))} />;
                            })}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button data-glassbtn id="logReadAll" title="Đánh dấu tất cả đã xem"
                      style={{height: 36, padding: '0 14px', borderRadius: 10}} onClick={readAll}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Đã xem</span>
              </button>
            </div>
          </div>

          <div id="logBox" className="nosb" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto'}}>
            {!loaded ? null
              : !rows.length
                ? <div className="hint" style={{padding: '16px 18px'}}>Chưa có cảnh báo nào từ AI box</div>
                : (
                  <div className="tl">
                    {rows.map((a, i) => (
                      <TlRow key={a.event_id != null ? a.event_id : 'ts' + (a.ts || 0)}
                        a={a} isNew={a.seen !== true} cleared={cleared}
                        onSkip={skipAlarm} onOpen={onOpen} onSeen={onSeen} onClip={onClip} />
                    ))}
                  </div>
                )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Dòng menu lọc — port mk() trong paintLogFilter (ui.js:755). */
function FilterRow({cls = '', label, n, color, onClick}) {
  return (
    <div className={'mrow' + (cls ? ' ' + cls : '')} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span className="dot" style={{background: color}} />
      <span className="l">{label}</span>
      <span className="k">{String(n)}</span>
      <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="#2a2410" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10"/></svg>
    </div>
  );
}

/* Một dòng timeline — port tlRow() (ui.js:874). isNew = alarm.seen chưa true
 * (backend ghi seen vào Mongo), nên khớp đúng badge số trên toàn app. */
function TlRow({a, isNew, cleared, onSkip, onOpen, onSeen, onClip}) {
  const t = new Date((a.ts || 0) * 1000);
  const g = algoGroups([a.algo_model])[0];
  const col = KIND_COLOR[g?.cat] || KIND_COLOR['Khác'];
  const cam = camOf(a);
  const img = imgOf(a);
  const vid = videoOf(a);
  const per = a.person;

  const showSkip = cam && !cleared.has(cam);
  const eventIdText = a.event_id ? `#${a.event_id}` : (a.id ? `#${a.id}` : null);
  const camLocation = a.channel_name || cam || 'Chưa xác định';
  const ipText = a.ipc_addr || '192.168.21.181';

  return (
    <div className="tl-row"
         data-id={a.event_id != null ? String(a.event_id) : 'ts' + (a.ts || '0')}>
      <div className="tl-t">
        <span className="tl-hm">{pad(t.getHours()) + ':' + pad(t.getMinutes())}</span>
        <span className="tl-sec">{':' + pad(t.getSeconds())}</span>
      </div>
      <div className="tl-mid">
        <div className="ln" />
        <span className="tl-dot" style={{background: col, color: col}} />
      </div>

      <div className="tl-b tl-b-3part">
        {/* Phần 1: Ảnh snapshot camera & Thông tin Báo động */}
        <div className="tl-sec-1">
          <div className="tl-th">
            {img
              ? <ImgThumb src={img} alt={'Ảnh phát hiện ' + (algoName(a.algo_model) || '')} />
              : <div className="no">không ảnh</div>}
            <div className="sc" />
            <span className="cam">Khu vực: {camLocation}</span>
            {vid && <div className="tl-play"><span>&#9654;</span></div>}
          </div>

          <div className="tl-mn">
            <div className="tl-chips">
              <span className="tl-kind" style={{color: col, borderColor: col + '40'}}>
                {(g?.cat || 'Khác').toUpperCase()}
              </span>
              {eventIdText && <span className="tl-id-badge">{eventIdText}</span>}
              {isNew && <span className="tl-new">MỚI</span>}
            </div>
            <span className="tl-ttl">{algoName(a.algo_model, a.algo_name) || a.label || '—'}</span>
            <span className="tl-sub">Khu vực: {camLocation} · IP: {ipText}</span>
          </div>
        </div>

        {/* Phần 2: Khung Nhận diện đối tượng (Person / Object Card) */}
        <div className="tl-sec-2">
          {/* Khung ảnh / avatar nhận diện */}
          <div className={'tl-per-box' + (per?.image ? ' has-img' : ' no-img')}>
            {per?.image ? (
              <ImgThumb src={absUrl(per.image.startsWith('/') ? per.image : 'alarms/' + per.image)} alt="Ảnh đối tượng" />
            ) : (
              <div className="tl-no-per">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>Không nhận diện được</span>
              </div>
            )}
          </div>

          {/* Các thông tin text nằm NGOÀI khung ảnh */}
          <div className="tl-per-txt">
            <div className="tl-per-nm">{per?.name ? per.name.toUpperCase() : 'Không nhận diện được'}</div>
            <div className={'tl-per-sc' + (per?.similarity != null ? ' active' : '')}>
              {per?.similarity != null ? `Độ chính xác ${per.similarity}%` : 'Chưa có thông tin'}
            </div>
            <div className="tl-per-badge-blue">
              {`${a.count || a.objects_count || 1} đối tượng phát hiện`}
            </div>
            <div className={'tl-per-link' + (per?.name ? '' : ' off')}>Chi tiết &rarr;</div>
          </div>
        </div>

        {/* Phần 3: Thao tác (Action Buttons) */}
        <div className="tl-sec-3">
          <div className="tl-actions-top">
            {/* Code gốc nút Bỏ qua:
            {showSkip && (
              <button className="tl-btn-opt" onClick={e => { e.stopPropagation(); onSkip(e, cam); }}>
                Bỏ qua
              </button>
            )} */}
            {img && (
              <button className="tl-btn-opt" onClick={e => { e.stopPropagation(); window.open(img, '_blank'); }}>
                Ảnh gốc
              </button>
            )}
            {vid && (
              <button className="tl-btn-opt" onClick={e => {
                e.stopPropagation();
                onSeen?.(a.event_id);
                onClip?.(cam, {url: vid, algo: algoName(a.algo_model) || a.label});
              }}>
                Xem clip
              </button>
            )}
          </div>

          {cam && (
            <button className="tl-btn-main" onClick={e => {
              e.stopPropagation();
              onSeen?.(a.event_id);
              onOpen?.(cam);
            }}>
              Mở camera &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* <img> bọc trong cấu trúc .tl-th (prepend giống vanilla) — tự xoá khi lỗi. */
function ImgThumb({src, alt}) {
  const [err, setErr] = useState(false);
  if (err) return <div className="no">không ảnh</div>;
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} />;
}

// Fragment — dùng trực tiếp (không import riêng) cho nhóm "Hành vi".