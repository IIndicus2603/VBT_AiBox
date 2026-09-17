import React, {useEffect, useRef, useState} from 'react';
import {BASE} from '../api/client.js';

/**
 * CẤU HÌNH HỆ THỐNG — port index.html section #v-cfg (kết nối AI SmartBox +
 * Telegram + nạp 20 thuật toán cho box) + ui.js cnLoad/cnPost/dkSlot, các handler
 * TG (tgRefresh/tgAdd/tgSave/tgTest), và loadAlgos/paintAlgos từ ui.js:1622.
 *
 * Các endpoint: GET/POST api/conn, api/conn/test, api/conn/docking/info,
 * api/conn/tgsave, api/conn/tgtest, api/tg/groups, api/tg/chatname,
 * api/sync, api/algo/all, api/hashrate, api/algo/save.
 */

/* ---------- Bảng tên + nhóm thuật toán (port ai.js ALGO_VI / ALGO_CAT) ---------- */

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
  FireDetection: 'Cháy', LongStayDetection: 'Ở lại quá lâu', FightDetectionAlarm: 'Đánh nhau',
  LineDetectorCrossed: 'Vượt vạch', EnterArea: 'Vào vùng', LeaveArea: 'Ra khỏi vùng',
  AreaRuleData: 'Đếm người trong vùng', LineRuleData: 'Đếm người qua vạch',
  ObjectIsRecognized: 'Nhận diện mặt', NonMotorAbnormalParkingDetection: 'Xe 2 bánh đỗ sai',
  UncoveredTrashCanDetection: 'Thùng rác mở nắp', MouseDetect: 'Chuột',
  BareSoilCoverDetection: 'Đất trống chưa phủ', DisorderStackingDetection: 'Xếp vật liệu sai',
  TrashOverflowingDetection: 'Thùng rác tràn', ExposedGarbageDetection: 'Rác lộ thiên',
  PackedGarbageDetection: 'Rác đóng túi', ShirtlessDetection: 'Không mặc áo',
  ChefHatAlarm: 'Không mũ đầu bếp', ChefClothesDetection: 'Không đồng phục đầu bếp',
  SafetyHarnessDetection: 'Không dây an toàn', ClimbingDetectionAlarm: 'Trèo leo',
  PeopleGathering: 'Tụ tập', FastMoving: 'Di chuyển nhanh', StayAloneDetection: 'Thiếu người trực',
  KnifeStickDetection: 'Cầm dao / gậy', UnwashedVehicleDetection: 'Xe chưa rửa',
  VehicleOverspeedDetection: 'Xe quá tốc độ', ForkliftOverspeedDetection: 'Xe nâng quá tốc độ',
  NoSafetyBeltDetection: 'Không thắt dây an toàn', PresetMarkerDetection: 'Mốc định sẵn',
  GasCylinderDetection: 'Bình gas', ChargingGunNotinPlace: 'Súng sạc không đúng chỗ',
  NoFireExtinguisherDetection: 'Thiếu bình chữa cháy', DumpTruckWithoutTarp: 'Xe ben không phủ bạt',
  OilLeakDetection: 'Rò dầu', GasLeakDetection: 'Rò khí', LiquidLeakDetection: 'Rò nước',
  TestPaperColorChangeDetection: 'Giấy thử đổi màu', NoSafetyGogglesDetection: 'Không kính bảo hộ',
  NoSafetyGlovesDetection: 'Không găng tay', NoDustGasMaskDetection: 'Không mặt nạ phòng độc',
  ExposedLongHairDetection: 'Tóc dài không buộc', CampusEntranceExitLPC: 'Biển số ra vào khu',
  CampusVehicleCongestionDetection: 'Ùn xe trong khu', DogDetection: 'Chó',
  FuelUnloadDetect: 'Xả dầu', Construction: 'Thi công đường', ThrowingEvent: 'Ném rác',
  TrafficAccident: 'Tai nạn giao thông', DriveSlowly: 'Xe chạy quá chậm',
  DriveAway: 'Xe rời đi', Fogging: 'Sương mù',
  NonMotorVehicleIntrusionDetection: 'Xe 2 bánh xâm nhập', OccupancyEmergencyLane: 'Chiếm làn khẩn cấp',
  Pedestrian: 'Người đi bộ xâm nhập', Retrograde: 'Xe đi ngược chiều',
  SnowCover: 'Tuyết phủ mặt đường', Congestion: 'Ùn tắc',
  VehicleEnterExitServiceStation: 'Xe ra vào trạm', ForkliftDetection: 'Xe nâng',
  EngineeringVehicleDetection: 'Xe công trình', IllegalAdditionOfBulkGasoline: 'Bơm xăng trái phép',
  WildlifeIntrusionDetection: 'Động vật xâm nhập', FireOperationUnattended: 'Hàn cắt không người trông',
  SmokeAndFireDetectionEvent: 'Khói và lửa', RestrictedAreaFishingDetection: 'Đánh bắt khu cấm',
  WaterOutletDischargeDetection: 'Xả thải cửa nước', HandDetection: 'Bàn tay',
  FreightInPassengerElevator: 'Chở hàng trong thang khách',
  ElectricBicycleIntrusionDetection: 'Chở hàng trong thang khách', LongQueueDetection: 'Xếp hàng dài',
  LightsLeftOnDetection: 'Quên tắt đèn', PedestrianAntiDirectionDetection: 'Người đi ngược chiều',
  ReverseMotionOnEscalator: 'Đi ngược thang cuốn', GunmanDetection: 'Súng',
  ShipDetection: 'Tàu thuyền', SurfaceWaterDetection: 'Ngập nước mặt đường',
  TrafficParameters: 'Thông số giao thông', TrafficParameter: 'Thông số giao thông',
};

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

const algoName = (m, fromBox) => fromBox || ALGO_VI[m] || m;

function algoGroups(models) {
  const has = new Set(models);
  const out = Object.entries(ALGO_CAT)
    .map(([cat, ms]) => ({cat, models: ms.filter(m => has.has(m))}))
    .filter(g => g.models.length);
  const rest = models.filter(m => !CAT_OF[m]);
  if (rest.length) out.push({cat: 'Khác', models: rest});
  return out;
}

/* ---------- POST tới backend qua BASE (không qua /aibox proxy của client.post) ---------- */
async function postCfg(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(25000),
  });
  return r.json();
}

const cnCls = col => (col === 'var(--ok)' ? 'ok' : (col === 'var(--warn)' || col === 'var(--err2)') ? 'err' : '');
const tgCls = col => (col === 'var(--ok)' ? 'ok' : (col === 'var(--warn)' || col === 'var(--err2)') ? 'err' : '');

export default function ConfigView() {
  /* ---- Kết nối box ---- */
  const [host, setHost] = useState('');
  const [port, setPort] = useState(80);
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [cnTxt, setCnTxt] = useState('Chưa kiểm tra');
  const [cnColor, setCnColor] = useState('');
  const [dkSlot, setDkSlot] = useState(1);
  const [dkOpen, setDkOpen] = useState(false);
  const dkBtnRef = useRef(null);
  const [dkPos, setDkPos] = useState({left: 0, top: 0});

  /* ---- Telegram ---- */
  const [tgToken, setTgToken] = useState('');
  const [tgTxt, setTgTxt] = useState('Chưa cấu hình');
  const [tgColor, setTgColor] = useState('');
  const [tgGroups, setTgGroups] = useState([]);   // [{id,title,type}]
  const [tgSel, setTgSel] = useState(() => new Set());
  const [tgManual, setTgManual] = useState('');
  const [tgPanel, setTgPanel] = useState(false);
  const [tgPanelPos, setTgPanelPos] = useState({left: 0, top: 0});
  const tgBtnRef = useRef(null);

  /* ---- Thuật toán ---- */
  const [alSup, setAlSup] = useState([]);
  const [alMax, setAlMax] = useState(20);
  const [alSel, setAlSel] = useState(() => new Set());
  const [alState, setAlState] = useState('');
  const [alStateCls, setAlStateCls] = useState('');
  const [alLoad, setAlLoad] = useState(true);
  const [alErr, setAlErr] = useState('');

  const nSel = alSel.size, full = nSel >= alMax;
  const label = nSel + '/' + alMax + ' thuật toán';

  /* ---- load cấu hình khi mở view ---- */
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const j = await (await fetch(BASE + 'api/conn')).json();
        const d = j.data || {};
        if (!on) return;
        setHost(d.host || ''); setPort(d.port || 80); setUser(d.user || 'admin');
        setCnTxt(d.host ? 'Đã lưu · ' + d.host + ':' + d.port : 'Chưa cấu hình');
        setCnColor(d.host ? 'var(--ok)' : 'var(--warn)');
        setTgSel(new Set(d.tg_chats || []));
        const nS = d.tg_setup_n || 0;
        setTgTxt(d.has_tg ? `Đã cấu hình · ${nS} nhóm /setup` : 'Chưa /setup');
        setTgColor(d.has_tg ? 'var(--ok)' : '');
      } catch {
        if (!on) return;
        setCnTxt('Không đọc được cấu hình (aibox.py chưa chạy?)');
        setCnColor('var(--err2)');
      }
    })();
    return () => { on = false; };
  }, []);

  /* ---- load thuật toán ---- */
  useEffect(() => {
    let on = true;
    (async () => {
      setAlLoad(true); setAlErr('');
      try {
        const j = await postCfg('api/algo/all');
        if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
        const d = j.data || {};
        if (!on) return;
        setAlSup(d.supported || []);
        setAlMax(d.max || 20);
        setAlSel(new Set(d.loaded || []));
        setAlLoad(false);
      } catch (e) {
        if (!on) return;
        setAlErr('Không đọc được /algo/list: ' + e.message);
        setAlLoad(false);
      }
    })();
    return () => { on = false; };
  }, []);

  /* ---- đóng menu khi click ngoài ---- */
  useEffect(() => {
    const h = e => {
      if (!e.target.closest('#dkSlotBtn, #dkSlotMenu')) setDkOpen(false);
      if (!e.target.closest('#tgPanel, #tgRefresh')) setTgPanel(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  /* ---- Trạng thái kết nối ---- */
  const cnState = (txt, col) => { setCnTxt(txt); setCnColor(col || ''); };

  /* ---- dkSlot dropdown positioning ---- */
  const dkToggle = e => {
    e && e.stopPropagation();
    if (dkOpen) { setDkOpen(false); return; }
    const btn = dkBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const h = 90; // đoán chiều cao menu (2 dòng) để quyết định lật lên
    setDkPos({
      left: r.left,
      width: r.width,
      top: (r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8),
    });
    setDkOpen(true);
  };
  const dkPick = slot => {
    setDkSlot(slot); setDkOpen(false);
  };

  /* ---- Lưu cấu hình ---- */
  const onSave = async () => {
    cnState('Đang lưu…');
    try {
      const j = await postCfg('api/conn', {
        host: host.trim(), port: +port || 80,
        user: user.trim(), pass: pass, slot: dkSlot,
      });
      if (j.code !== 0) return cnState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
      setPass('');
      const dk = (j.data || {}).docking || {};
      cnState(dk.ok ? 'Đã lưu · alarm → platform ' + dk.slot : 'Đã lưu · chưa đăng ký alarm',
              dk.ok ? 'var(--ok)' : 'var(--warn)');
    } catch (e) { cnState(e.message, 'var(--err2)'); }
  };

  const onTest = async () => {
    cnState('Đang thử kết nối…');
    try {
      const j = await postCfg('api/conn/test');
      if (j.code !== 0) return cnState('Lỗi ' + j.code + ': ' + (j.msg || ''), 'var(--err2)');
      const d = j.data || {};
      const boxTxt = 'OK · ' + (d.device_name || d.model || '') + ' · SN '
        + (d.device_sn || d.serial_number || '—');
      try {
        // docking/info là route GET (chỉ đọc), postCfg dùng POST -> 405, slots rỗng.
        const k = await (await fetch(BASE + 'api/conn/docking/info')).json();
        const slots = (k.data || {}).slots || [];
        const who = s => (s.enabled ? s.owner : 'trống');
        const txt = slots.map(s => `P${s.slot}: ${who(s)}`).join(' · ');
        cnState(boxTxt + '\nPlatform ' + txt, 'var(--ok)');
      } catch {
        cnState(boxTxt, 'var(--ok)');
      }
    } catch (e) { cnState(e.message, 'var(--err2)'); }
  };

  const onSync = async () => {
    cnState('Đang đồng bộ camera từ box…');
    try {
      const j = await postCfg('api/sync');
      if (j.code !== 0) return cnState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
      const n = a => (a || []).length;
      cnState(`Đồng bộ xong · thêm ${n(j.added)} · xoá ${n(j.removed)} · giữ ${n(j.kept)}`, 'var(--ok)');
    } catch (e) { cnState(e.message, 'var(--err2)'); }
  };

  /* ---- Telegram ---- */
  const tgState = (txt, col) => { setTgTxt(txt); setTgColor(col || ''); };

  const renderTgGroups = () => {
    const warnBox = !tgSel.size ? (
      <div key="warn" className="tg-nosel"
           style={{display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 11px', margin: '0 0 8px',
                   borderRadius: 11, border: '1px solid rgba(255,171,64,.45)', background: 'rgba(255,171,64,.10)',
                   font: '600 11.5px/1.45 var(--b)', color: '#ffb24d'}}>
        Cách dùng: thêm bot vào nhóm Telegram, gõ /setup all trong nhóm đó là bắt đầu nhận cảnh báo. Dưới đây là cách cũ (tick để gửi ngay), có thể bỏ qua.
      </div>
    ) : null;
    const ids = [...new Set([...tgGroups.map(g => g.id), ...tgSel])];
    const byId = Object.fromEntries(tgGroups.map(g => [g.id, g]));
    if (!ids.length) {
      return (
        <div>
          {warnBox}
          <span className="hint">Chưa thấy nhóm nào — thêm bot vào nhóm Telegram rồi bấm "Quét nhóm" lại.</span>
        </div>
      );
    }
    return (
      <div>
        {warnBox}
        {ids.map(id => {
          const g = byId[id] || {id, title: id, type: ''};
          const on = tgSel.has(id);
          return (
            <label key={id}
                   style={{display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: 11,
                           border: '1px solid ' + (on ? 'rgba(213,194,149,.5)' : 'rgba(255,255,255,.1)'),
                           cursor: 'pointer', margin: '0 0 6px',
                           background: on ? 'rgba(213,194,149,.14)' : 'rgba(255,255,255,.03)',
                           transition: 'background .18s,border-color .18s'}}>
              <input type="checkbox" checked={on}
                     onChange={() => {
                       const next = new Set(tgSel);
                       if (on) next.delete(id); else next.add(id);
                       setTgSel(next);
                     }}
                     style={{width: 15, height: 15, accentColor: 'var(--gold)', flex: 'none', cursor: 'pointer'}} />
              <span style={{flex: 1, minWidth: 0, font: '600 12.5px/1.2 var(--b)', color: 'var(--dim)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {g.title || id}
              </span>
              <span style={{flex: 'none', font: '400 10px/1 var(--m)', color: 'var(--ghost)'}}>
                {(g.type ? g.type + ' · ' : '') + id}
              </span>
            </label>
          );
        })}
      </div>
    );
  };

  const onTgRefresh = async e => {
    e && e.stopPropagation();
    if (tgBtnRef.current) {
      const r = tgBtnRef.current.getBoundingClientRect();
      const h = 400;
      setTgPanelPos({
        left: Math.min(r.left, innerWidth - 480),
        top: (r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8),
      });
    }
    setTgPanel(true);
    tgState('Đang quét nhóm…');
    try {
      const j = await postCfg('api/tg/groups');
      setTgGroups((j.data && j.data.groups) || []);
      if (j.data && j.data.selected) setTgSel(new Set(j.data.selected));
      if (!j.data || !(j.data.groups || []).length) {
        tgState(j.code === 0 ? 'Chưa thấy nhóm nào — thêm bot vào nhóm rồi quét lại' : (j.msg || 'Lỗi'),
                j.code === 0 ? 'var(--warn)' : 'var(--err2)');
      } else {
        tgState('Thấy ' + (j.data.groups || []).length + ' nhóm — tick rồi bấm Lưu', 'var(--ok)');
      }
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgAdd = async () => {
    const v = tgManual.trim();
    if (!v) return;
    tgState('Đang lấy thông tin nhóm…');
    try {
      let title = v, cid = v;
      try {
        const j = await postCfg('api/tg/chatname', {id: v});
        if (j.code === 0 && j.data && j.data.title) { title = j.data.title; cid = j.data.id || v; }
        else {
          tgState(j.msg || 'Không lấy được thông tin nhóm — bot chưa trong nhóm hoặc ID sai', 'var(--err2)');
          return;
        }
      } catch { /* lỗi mạng -> vẫn cho thêm */ }
      const next = new Set(tgSel); next.add(cid);
      setTgSel(next);
      let g = tgGroups.find(x => x.id === cid);
      if (g) { g = {...g, title}; setTgGroups(tgGroups.map(x => x.id === cid ? g : x)); }
      else setTgGroups([...tgGroups, {id: cid, title, type: ''}]);
      setTgManual('');
      tgState('Đã thêm nhóm: ' + title, 'var(--ok)');
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgSave = async () => {
    tgState('Đang lưu…');
    try {
      const j = await postCfg('api/conn/tgsave', {
        tg_token: tgToken, tg_chats: [...tgSel],
      });
      if (j.code !== 0) return tgState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
      setTgToken('');
      const d = j.data || {};
      setTgSel(new Set(d.tg_chats || []));
      tgState(d.has_tg ? 'Đã lưu · đẩy tới ' + (d.tg_chats || []).length + ' nhóm' : 'Đã tắt (chưa tick nhóm nào)', 'var(--ok)');
      setTgPanel(false);
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgTest = async () => {
    if (!tgSel.size) return tgState('Chưa tick nhóm nào', 'var(--warn)');
    tgState('Đang gửi thử…');
    try {
      const s = await postCfg('api/conn/tgsave', {tg_token: tgToken, tg_chats: [...tgSel]});
      if (s.code !== 0) return tgState(s.msg || 'Lỗi lưu', 'var(--err2)');
      setTgToken('');
      const j = await postCfg('api/conn/tgtest');
      if (j.code !== 0) return tgState(j.msg || 'Lỗi ' + j.code, 'var(--err2)');
      tgState(j.msg || 'Đã gửi — mở nhóm Telegram để xem', 'var(--ok)');
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  /* ---- Thuật toán ---- */
  const onAlgoPick = m => {
    const next = new Set(alSel);
    if (next.has(m)) next.delete(m);
    else if (next.size >= alMax) return;
    else next.add(m);
    setAlSel(next);
  };

  const onAlgoSave = async () => {
    const models = [...alSel];
    if (!models.length) { setAlState('Chưa chọn thuật toán nào'); setAlStateCls('err'); return; }
    setAlStateCls('');
    setAlState('Đang kiểm tra công suất…');
    try {
      const hr = await postCfg('api/hashrate', {channel_id: 1, algo_model: models});
      if (hr.status_code === 52040) {
        setAlStateCls('err');
        setAlState('Box báo không đủ công suất cho bộ này — bỏ bớt thuật toán');
        return;
      }
      setAlState('Đang nạp vào box…');
      const j = await postCfg('api/algo/save', {algo_model: models});
      if (j.code === 0) {
        setAlStateCls('ok');
        setAlState(`Đã nạp ${models.length} thuật toán`);
        // reload lại trạng thái từ box
        const r = await postCfg('api/algo/all');
        const d = r.data || {};
        setAlSup(d.supported || []); setAlMax(d.max || 20); setAlSel(new Set(d.loaded || []));
        return;
      }
      setAlStateCls('err');
      setAlState(j.msg || 'Box từ chối (code ' + j.code + ')');
    } catch (e) {
      setAlStateCls('err');
      setAlState(e.message);
    }
  };

  const onAlgoWeb = async () => {
    const j = await (await fetch(BASE + 'api/conn')).json().catch(() => ({}));
    const h = (j.data || {}).host;
    if (h) window.open('http://' + h + '/#/smart-capabilities/algorithmic-capability', '_blank');
  };

  const cats = alErr ? null : algoGroups(alSup);

  /* ============================ RENDER ============================ */

  return (
    <section className="view" id="v-cfg">
      <div className="view-wrap">
        <div className="bar" style={{gap: 12, flexWrap: 'wrap', marginBottom: 16}}>
          <span className="view-h" data-i18n="tCfg">Cấu hình hệ thống</span>
          <span className={'al-cnt' + (full ? ' full' : '')} id="alCnt">{label}</span>
          <div className="grow"></div>
        </div>

        <div className="nosb" style={{flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', display: 'flex', flexDirection: 'column'}}>
          {/* ---- Kết nối AI SmartBox ---- */}
          <div className="card" data-glass style={{flex: 'none', borderRadius: 20, padding: 18, marginBottom: 14, overflow: 'visible'}}>
            <div className="card-h" style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11}}>
              Kết nối AI SmartBox
              <div className="grow"></div>
              <span className={'cn-state ' + cnCls(cnColor)} id="cnState" style={{textTransform: 'none', letterSpacing: 0, maxWidth: '60%'}}>{cnTxt}</span>
            </div>
            <div style={{display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap'}}>
              <div className="field" style={{flex: '1 1 150px', maxWidth: 210}}>
                <label>IP / Hostname</label>
                <input id="cnHost" className="mono" placeholder="192.168.21.93" autoComplete="off"
                       value={host} onChange={e => setHost(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 0 84px'}}>
                <label>Cổng</label>
                <input id="cnPort" className="mono" type="number" min="1" max="65535"
                       value={port} onChange={e => setPort(+e.target.value || 80)} />
              </div>
              <div className="field" style={{flex: '0 1 130px'}}>
                <label>Tài khoản</label>
                <input id="cnUser" className="mono" placeholder="admin" autoComplete="off"
                       value={user} onChange={e => setUser(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 1 150px'}}>
                <label>Mật khẩu</label>
                <input id="cnPass" className="mono" type="password" placeholder="••••••"
                       autoComplete="new-password"
                       title="Bỏ trống = giữ mật khẩu đang dùng. Mật khẩu lưu plaintext trong aibox.conf.json — đừng commit file này."
                       value={pass} onChange={e => setPass(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 0 130px'}}>
                <label>Đăng ký alarm</label>
                <div className="dk-wrap" style={{position: 'relative'}}>
                  <button data-glassbtn type="button" id="dkSlotBtn" ref={dkBtnRef}
                          onClick={dkToggle}
                          aria-haspopup="listbox" aria-expanded={dkOpen}
                          style={{width: '100%', height: 43, justifyContent: 'space-between', gap: 0, padding: '0 12px', borderRadius: 12, font: '400 12.5px/1 var(--m)', color: '#f5f5f7'}}>
                    <span id="dkSlotLbl">Platform {dkSlot}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 11, height: 11, opacity: .55, flex: 'none'}}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
              </div>
              <div className="grow"></div>
              <button data-glassbtn id="cnTest" style={{height: 38}} onClick={onTest}>Kiểm tra kết nối</button>
              <button data-glassbtn id="cnSync" style={{height: 38}} onClick={onSync}>Đồng bộ camera</button>
              <button data-goldbtn id="cnSave" style={{height: 38, padding: '0 18px'}} onClick={onSave}>Lưu</button>
            </div>
          </div>

          {/* ---- Telegram ---- */}
          <div className="card" data-glass style={{position: 'relative', overflow: 'visible', flex: 'none', borderRadius: 20, padding: 18, marginBottom: 14}}>
            <div className="card-h" style={{marginBottom: 14}}>Telegram — đẩy cảnh báo vào nhóm</div>
            <div style={{display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap'}}>
              <div className="field" style={{flex: '1 1 240px', maxWidth: 420}}>
                <label>Bot Token</label>
                <input id="tgToken" className="mono" type="password" placeholder="123456:ABC-DEF..." autoComplete="off"
                       value={tgToken} onChange={e => setTgToken(e.target.value)} />
              </div>
              <button data-glassbtn id="tgRefresh" ref={tgBtnRef}
                      onClick={onTgRefresh}
                      style={{height: 38, padding: '0 14px', borderRadius: 12, flex: 'none'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 12, height: 12}}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
                Quét nhóm
              </button>
              <div className="grow"></div>
              <span className={'tg-chip ' + tgCls(tgColor)} id="tgState">{tgTxt}</span>
            </div>
            <div style={{marginTop: 9, font: '500 11px/1.5 var(--b)', color: 'var(--dim)', opacity: .85}}>
              Cách dùng: nhập Bot Token ở trên, thêm bot vào nhóm Telegram, rồi trong
              nhóm gõ <span className="mono">/setup all</span> — bắt đầu nhận cảnh báo.
              Gõ <span className="mono">/setup</span> để xem hướng dẫn,
              <span className="mono"> /setup off</span> để tắt. "Quét nhóm" + tick chỉ là cách cũ.
            </div>
          </div>

          {/* ---- Thuật toán đang nạp ---- */}
          <div data-glass className="nosb" style={{flex: 'none', borderRadius: 20, display: 'flex', flexDirection: 'column'}}>
            <div data-glass style={{position: 'sticky', top: 0, zIndex: 2, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.1)', flexWrap: 'wrap', background: 'linear-gradient(168deg,rgba(18,20,24,.86),rgba(18,20,24,.68))', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)'}}>
              <span className="card-h" style={{whiteSpace: 'nowrap'}}>Thuật toán đang nạp</span>
              <div style={{flex: 1, minWidth: 80, height: 5, borderRadius: 99, background: 'rgba(255,255,255,.1)', overflow: 'hidden'}}>
                <i id="alBar" style={{display: 'block', height: '100%', width: (nSel / Math.max(1, alMax) * 100) + '%', borderRadius: 99, background: 'linear-gradient(90deg,#cdb98a,#e6dbba)', transition: 'width .3s ease'}}></i>
              </div>
              <span className={'al-cnt' + (full ? ' full' : '')} id="alCnt2" style={{whiteSpace: 'nowrap'}}>{label}</span>
            </div>

            <div className="al-thead" data-camhead style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', border: 'none', borderRadius: 0, borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', marginBottom: 0}}>
              <span style={{flex: 'none', width: 200}}>Danh mục</span>
              <span style={{flex: 'none', width: 1, height: 12, background: 'rgba(255,255,255,.09)'}}></span>
              <span>Thuật toán</span>
            </div>

            <div id="alCats" style={{border: 'none', borderRadius: 0}}>
              {alLoad && (
                <div className="al-load">Đang đọc thuật toán từ box…</div>
              )}
              {!alLoad && alErr && (
                <div className="al-load" style={{color: 'var(--err2)'}}>{alErr}</div>
              )}
              {!alLoad && !alErr && !cats.length && (
                <div className="al-load">Box không trả thuật toán nào (/algo/list rỗng)</div>
              )}
              {!alLoad && !alErr && cats.map(g => {
                const chosen = g.models.filter(m => alSel.has(m)).length;
                return (
                  <div className="al-cat" key={g.cat}>
                    <div className="al-cat-h">
                      <span className="al-cat-n">{g.cat}</span>
                      <span className="al-cat-c">{chosen}/{g.models.length}</span>
                    </div>
                    <div className="al-grid">
                      {g.models.map(m => {
                        const on = alSel.has(m);
                        return (
                          <div key={m} className={'al-item' + (on ? ' on' : '') + (!on && full ? ' dis' : '')}
                               title={m} onClick={() => onAlgoPick(m)}>
                            <span className="al-box"></span>
                            <span className="al-nm">{algoName(m)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div data-glass className="al-foot" style={{position: 'sticky', bottom: 0, flex: 'none', zIndex: 2, padding: '13px 18px', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,.1)', borderRadius: 0, background: 'linear-gradient(168deg,rgba(18,20,24,.86),rgba(18,20,24,.68))', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)'}}>
              <span className="hint" id="alHint">
                {full
                  ? 'Đã đạt giới hạn ' + alMax + ' thuật toán — bỏ bớt trước khi chọn thêm'
                  : 'Box giới hạn ' + alMax + ' thuật toán nạp cùng lúc'}
              </span>
              <div className="grow"></div>
              <span className={'cn-state ' + alStateCls} id="alState">{alState}</span>
              <button data-glassbtn id="alWeb" style={{height: 38}} onClick={onAlgoWeb}>Đổi trên web box ↗</button>
              <button data-goldbtn id="alSave" style={{height: 38, padding: '0 18px'}} onClick={onAlgoSave}>Nạp thuật toán</button>
            </div>
          </div>
        </div>
      </div>

      {/* ---- dkSlot menu (fixed top-level) ---- */}
      {dkOpen && (
        <div id="dkSlotMenu" className="menu" data-glass
             style={{position: 'fixed', padding: 6, zIndex: 99999, borderRadius: 14, left: dkPos.left, width: dkPos.width, top: dkPos.top,
                     background: 'linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,.06))',
                     border: '1px solid rgba(255,255,255,.22)', boxShadow: '0 16px 34px rgba(0,0,0,.55)', animation: 'none'}}>
          {[1, 2].map(s => (
            <div key={s} className={'mrow' + (dkSlot === s ? ' on' : '')} data-slot={s} role="option"
                 onClick={e => { e.stopPropagation(); dkPick(s); }}>
              <span className="l">Platform {s}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- tgPanel (fixed top-level) ---- */}
      {tgPanel && (
        <div id="tgPanel" className="tg-panel" style={{left: tgPanelPos.left, top: tgPanelPos.top}}
             onClick={e => e.stopPropagation()}>
          <div className="tg-panel-h">Nhóm nhận cảnh báo</div>
          <div id="tgGroups" className="tg-groups">{renderTgGroups()}</div>
          <div className="field" style={{marginTop: 10}}>
            <label>Thêm Chat ID thủ công (nhóm im lặng — Quét không thấy được)</label>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <input id="tgChatManual" className="mono" placeholder="VD: -1001234567890" autoComplete="off"
                     style={{flex: 1, minWidth: 0}} value={tgManual}
                     onChange={e => setTgManual(e.target.value)} />
              <button data-glassbtn id="tgAdd" style={{height: 36, padding: '0 14px', borderRadius: 12, flex: 'none'}}
                      onClick={onTgAdd}>Thêm</button>
            </div>
          </div>
          <div className="tg-panel-f">
            <button data-glassbtn id="tgTest" style={{height: 36}} onClick={onTgTest}>Gửi thử</button>
            <button data-glassbtn id="tgClose" style={{height: 36, padding: '0 14px'}} onClick={() => setTgPanel(false)}>Đóng</button>
            <button data-goldbtn id="tgSave" style={{height: 36, padding: '0 18px'}} onClick={onTgSave}>Lưu</button>
          </div>
        </div>
      )}
    </section>
  );
}