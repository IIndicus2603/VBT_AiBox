import React, {useEffect, useRef, useState} from 'react';
import {BASE} from '../api/client.js';
import {useTranslation} from '../i18n/index.jsx';

/**
 * CẤU HÌNH HỆ THỐNG — port index.html section #v-cfg (kết nối AI SmartBox +
 * Telegram + nạp 20 thuật toán cho box) + ui.js cnLoad/cnPost/dkSlot, các handler
 * TG (tgRefresh/tgAdd/tgSave/tgTest), và loadAlgos/paintAlgos từ ui.js:1622.
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

const algoName = (t, m, fromBox) => {
  if (fromBox) return fromBox;
  const translated = t('algos.' + m);
  if (translated && translated !== 'algos.' + m) return translated;
  return ALGO_VI[m] || m;
};

function algoGroups(t, models) {
  const has = new Set(models);
  const out = Object.entries(ALGO_CAT)
    .map(([catKey, ms]) => {
      let i18nCat = catKey;
      if (catKey === 'Chức năng chung') i18nCat = t('categories.general');
      else if (catKey === 'Môi trường') i18nCat = t('categories.environment');
      else if (catKey === 'Bảo hộ lao động (PPE)') i18nCat = t('categories.ppe');
      else if (catKey === 'Hành vi') i18nCat = t('categories.behavior');
      else if (catKey === 'Phương tiện') i18nCat = t('categories.vehicle');
      else if (catKey === 'Sự kiện đường cao tốc') i18nCat = t('categories.highway');
      else if (catKey === 'Thuỷ lợi / Quản lý đô thị') i18nCat = t('categories.urban');
      else if (catKey === 'AlertFree') i18nCat = t('categories.alertFree');

      return {catKey, cat: i18nCat, models: ms.filter(m => has.has(m))};
    })
    .filter(g => g.models.length);
  const rest = models.filter(m => !CAT_OF[m]);
  if (rest.length) out.push({catKey: 'Khác', cat: t('categories.other'), models: rest});
  return out;
}

/* ---------- POST tới backend qua BASE ---------- */
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
  const {t} = useTranslation();

  /* ---- Kết nối box ---- */
  const [host, setHost] = useState('');
  const [port, setPort] = useState(80);
  const [user, setUser] = useState('admin');
  const [pass, setPass] = useState('');
  const [cnTxt, setCnTxt] = useState(() => t('cfg.notChecked'));
  const [cnColor, setCnColor] = useState('');
  const [dkSlot, setDkSlot] = useState(1);
  const [dkOpen, setDkOpen] = useState(false);
  const dkBtnRef = useRef(null);
  const [dkPos, setDkPos] = useState({left: 0, top: 0});

  /* ---- Telegram ---- */
  const [tgToken, setTgToken] = useState('');
  const [tgTxt, setTgTxt] = useState(() => t('cfg.notConfigured'));
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
  const label = `${nSel}/${alMax} ${t('cfg.algoNameCol')}`;

  /* ---- load cấu hình khi mở view ---- */
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const j = await (await fetch(BASE + 'api/conn')).json();
        const d = j.data || {};
        if (!on) return;
        setHost(d.host || ''); setPort(d.port || 80); setUser(d.user || 'admin');
        setCnTxt(d.host ? `${t('cfg.saved')} · ${d.host}:${d.port}` : t('cfg.notConfigured'));
        setCnColor(d.host ? 'var(--ok)' : 'var(--warn)');
        setTgSel(new Set(d.tg_chats || []));
        const nS = d.tg_setup_n || 0;
        setTgTxt(d.has_tg ? `${t('cfg.saved')} · ${nS} nhóm /setup` : t('cfg.notSetup'));
        setTgColor(d.has_tg ? 'var(--ok)' : '');
      } catch {
        if (!on) return;
        setCnTxt(t('cfg.connReadErr') || 'Không đọc được cấu hình');
        setCnColor('var(--err2)');
      }
    })();
    return () => { on = false; };
  }, [t]);

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
        setAlErr(t('cfg.readingAlgosErr', {err: e.message}) || ('Lỗi: ' + e.message));
        setAlLoad(false);
      }
    })();
    return () => { on = false; };
  }, [t]);

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
    const h = 90;
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
    cnState(t('cfg.saving'));
    try {
      const j = await postCfg('api/conn', {
        host: host.trim(), port: +port || 80,
        user: user.trim(), pass: pass, slot: dkSlot,
      });
      if (j.code !== 0) return cnState(j.msg || ('Lỗi ' + j.code), 'var(--err2)');
      setPass('');
      const dk = (j.data || {}).docking || {};
      cnState(dk.ok ? t('cfg.savedPlatform', {slot: dk.slot}) : t('cfg.savedNoAlarm'),
              dk.ok ? 'var(--ok)' : 'var(--warn)');
    } catch (e) { cnState(e.message, 'var(--err2)'); }
  };

  const onTest = async () => {
    cnState(t('cfg.testingConn'));
    try {
      const j = await postCfg('api/conn/test');
      if (j.code !== 0) return cnState('Lỗi ' + j.code + ': ' + (j.msg || ''), 'var(--err2)');
      const d = j.data || {};
      const boxTxt = 'OK · ' + (d.device_name || d.model || '') + ' · SN '
        + (d.device_sn || d.serial_number || '—');
      try {
        const k = await (await fetch(BASE + 'api/conn/docking/info')).json();
        const slots = (k.data || {}).slots || [];
        const who = s => (s.enabled ? s.owner : t('cfg.emptySlot'));
        const txt = slots.map(s => `P${s.slot}: ${who(s)}`).join(' · ');
        cnState(boxTxt + '\nPlatform ' + txt, 'var(--ok)');
      } catch {
        cnState(boxTxt, 'var(--ok)');
      }
    } catch (e) { cnState(e.message, 'var(--err2)'); }
  };

  const onSync = async () => {
    cnState(t('cfg.syncingCams'));
    try {
      const j = await postCfg('api/sync');
      if (j.code !== 0) return cnState(j.msg || ('Lỗi ' + j.code), 'var(--err2)');
      const n = a => (a || []).length;
      cnState(t('cfg.syncedDone', {added: n(j.added), removed: n(j.removed), kept: n(j.kept)}), 'var(--ok)');
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
        {t('cfg.tgUsageHint')}
      </div>
    ) : null;
    const ids = [...new Set([...tgGroups.map(g => g.id), ...tgSel])];
    const byId = Object.fromEntries(tgGroups.map(g => [g.id, g]));
    if (!ids.length) {
      return (
        <div>
          {warnBox}
          <span className="hint">{t('cfg.tgNoGroups')}</span>
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
    tgState(t('cfg.scanningGroups'));
    try {
      const j = await postCfg('api/tg/groups');
      setTgGroups((j.data && j.data.groups) || []);
      if (j.data && j.data.selected) setTgSel(new Set(j.data.selected));
      if (!j.data || !(j.data.groups || []).length) {
        tgState(j.code === 0 ? t('cfg.tgNoGroups') : (j.msg || 'Lỗi'),
                j.code === 0 ? 'var(--warn)' : 'var(--err2)');
      } else {
        tgState(t('cfg.foundGroups', {count: (j.data.groups || []).length}), 'var(--ok)');
      }
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgAdd = async () => {
    const v = tgManual.trim();
    if (!v) return;
    tgState(t('cfg.addingGroup'));
    try {
      let title = v, cid = v;
      try {
        const j = await postCfg('api/tg/chatname', {id: v});
        if (j.code === 0 && j.data && j.data.title) { title = j.data.title; cid = j.data.id || v; }
        else {
          tgState(j.msg || 'Không lấy được thông tin nhóm', 'var(--err2)');
          return;
        }
      } catch { /* lỗi mạng -> vẫn cho thêm */ }
      const next = new Set(tgSel); next.add(cid);
      setTgSel(next);
      let g = tgGroups.find(x => x.id === cid);
      if (g) { g = {...g, title}; setTgGroups(tgGroups.map(x => x.id === cid ? g : x)); }
      else setTgGroups([...tgGroups, {id: cid, title, type: ''}]);
      setTgManual('');
      tgState(t('cfg.addedGroup', {title}), 'var(--ok)');
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgSave = async () => {
    tgState(t('cfg.saving'));
    try {
      const j = await postCfg('api/conn/tgsave', {
        tg_token: tgToken, tg_chats: [...tgSel],
      });
      if (j.code !== 0) return tgState(j.msg || ('Lỗi ' + j.code), 'var(--err2)');
      setTgToken('');
      const d = j.data || {};
      setTgSel(new Set(d.tg_chats || []));
      tgState(d.has_tg ? t('cfg.tgSaved', {count: (d.tg_chats || []).length}) : t('cfg.tgDisabled'), 'var(--ok)');
      setTgPanel(false);
    } catch (err) { tgState(err.message, 'var(--err2)'); }
  };

  const onTgTest = async () => {
    if (!tgSel.size) return tgState(t('cfg.tgNoSel'), 'var(--warn)');
    tgState(t('cfg.sendingTest'));
    try {
      const s = await postCfg('api/conn/tgsave', {tg_token: tgToken, tg_chats: [...tgSel]});
      if (s.code !== 0) return tgState(s.msg || 'Lỗi lưu', 'var(--err2)');
      setTgToken('');
      const j = await postCfg('api/conn/tgtest');
      if (j.code !== 0) return tgState(j.msg || ('Lỗi ' + j.code), 'var(--err2)');
      tgState(j.msg || t('cfg.testSent'), 'var(--ok)');
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
    if (!models.length) { setAlState(t('cfg.noAlgoSelected')); setAlStateCls('err'); return; }
    setAlStateCls('');
    setAlState(t('cfg.checkingCapacity'));
    try {
      const hr = await postCfg('api/hashrate', {channel_id: 1, algo_model: models});
      if (hr.status_code === 52040) {
        setAlStateCls('err');
        setAlState(t('cfg.insufficientCapacity'));
        return;
      }
      setAlState(t('cfg.loadingAlgosToBox'));
      const j = await postCfg('api/algo/save', {algo_model: models});
      if (j.code === 0) {
        setAlStateCls('ok');
        setAlState(t('cfg.loadedAlgosCount', {count: models.length}));
        // reload lại trạng thái từ box
        const r = await postCfg('api/algo/all');
        const d = r.data || {};
        setAlSup(d.supported || []); setAlMax(d.max || 20); setAlSel(new Set(d.loaded || []));
        return;
      }
      setAlStateCls('err');
      setAlState(j.msg || ('Box từ chối (code ' + j.code + ')'));
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

  const cats = alErr ? null : algoGroups(t, alSup);

  /* ============================ RENDER ============================ */

  return (
    <section className="view" id="v-cfg">
      <div className="view-wrap">

        <div className="nosb" style={{flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto', display: 'flex', flexDirection: 'column'}}>
          {/* ---- Kết nối AI SmartBox ---- */}
          <div className="card" data-glass style={{flex: 'none', borderRadius: 20, padding: 18, marginBottom: 14, overflow: 'visible'}}>
            <div className="card-h" style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11}}>
              {t('cfg.connTitle')}
              <div className="grow"></div>
              <span className={'cn-state ' + cnCls(cnColor)} id="cnState" style={{textTransform: 'none', letterSpacing: 0, maxWidth: '60%'}}>{cnTxt}</span>
            </div>
            <div style={{display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap'}}>
              <div className="field" style={{flex: '1 1 150px', maxWidth: 210}}>
                <label>{t('cfg.ipHost')}</label>
                <input id="cnHost" className="mono" placeholder="192.168.21.93" autoComplete="off"
                       value={host} onChange={e => setHost(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 0 84px'}}>
                <label>{t('cfg.port')}</label>
                <input id="cnPort" className="mono" type="number" min="1" max="65535"
                       value={port} onChange={e => setPort(+e.target.value || 80)} />
              </div>
              <div className="field" style={{flex: '0 1 130px'}}>
                <label>{t('cfg.username')}</label>
                <input id="cnUser" className="mono" placeholder="admin" autoComplete="off"
                       value={user} onChange={e => setUser(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 1 150px'}}>
                <label>{t('cfg.password')}</label>
                <input id="cnPass" className="mono" type="password" placeholder="••••••"
                       autoComplete="new-password"
                       title={t('cfg.passHint')}
                       value={pass} onChange={e => setPass(e.target.value)} />
              </div>
              <div className="field" style={{flex: '0 0 130px'}}>
                <label>{t('cfg.alarmReg')}</label>
                <div className="dk-wrap" style={{position: 'relative'}}>
                  <button data-glassbtn type="button" id="dkSlotBtn" ref={dkBtnRef}
                          onClick={dkToggle}
                          aria-haspopup="listbox" aria-expanded={dkOpen}
                          style={{width: '100%', height: 43, justifyContent: 'space-between', gap: 0, padding: '0 12px', borderRadius: 12, font: '400 12.5px/1 var(--m)', color: '#f5f5f7'}}>
                    <span id="dkSlotLbl">{t('cfg.platform', {slot: dkSlot})}</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 11, height: 11, opacity: .55, flex: 'none'}}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
              </div>
              <div className="grow"></div>
              <button data-glassbtn id="cnTest" style={{height: 38}} onClick={onTest}>{t('cfg.testConn')}</button>
              <button data-glassbtn id="cnSync" style={{height: 38}} onClick={onSync}>{t('cfg.syncCam')}</button>
              <button data-goldbtn id="cnSave" style={{height: 38, padding: '0 18px'}} onClick={onSave}>{t('common.save')}</button>
            </div>
          </div>

          {/* ---- Thuật toán đang nạp ---- */}
          <div data-glass className="nosb" style={{flex: 'none', borderRadius: 20, display: 'flex', flexDirection: 'column'}}>
            <div data-glass style={{position: 'sticky', top: 0, zIndex: 2, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.1)', flexWrap: 'wrap', background: 'linear-gradient(168deg,rgba(18,20,24,.86),rgba(18,20,24,.68))', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)'}}>
              <span className="card-h" style={{whiteSpace: 'nowrap'}}>{t('cfg.loadedAlgos')}</span>
              <div style={{flex: 1, minWidth: 80, height: 5, borderRadius: 99, background: 'rgba(255,255,255,.1)', overflow: 'hidden'}}>
                <i id="alBar" style={{display: 'block', height: '100%', width: (nSel / Math.max(1, alMax) * 100) + '%', borderRadius: 99, background: 'linear-gradient(90deg,#cdb98a,#e6dbba)', transition: 'width .3s ease'}}></i>
              </div>
              <span className={'al-cnt' + (full ? ' full' : '')} id="alCnt2" style={{whiteSpace: 'nowrap'}}>{label}</span>
            </div>

            <div className="al-thead" data-camhead style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', border: 'none', borderRadius: 0, borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.025)', marginBottom: 0}}>
              <span style={{flex: 'none', width: 200}}>{t('cfg.algoCategory')}</span>
              <span style={{flex: 'none', width: 1, height: 12, background: 'rgba(255,255,255,.09)'}}></span>
              <span>{t('cfg.algoNameCol')}</span>
            </div>

            <div id="alCats" style={{border: 'none', borderRadius: 0}}>
              {alLoad && (
                <div className="al-load">{t('cfg.readingAlgos')}</div>
              )}
              {!alLoad && alErr && (
                <div className="al-load" style={{color: 'var(--err2)'}}>{alErr}</div>
              )}
              {!alLoad && !alErr && !cats.length && (
                <div className="al-load">{t('cfg.noAlgosFromBox')}</div>
              )}
              {!alLoad && !alErr && cats.map(g => {
                const chosen = g.models.filter(m => alSel.has(m)).length;
                return (
                  <div className="al-cat" key={g.catKey}>
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
                            <span className="al-nm">{algoName(t, m)}</span>
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
                  ? t('cfg.algoMaxReached', {max: alMax})
                  : t('cfg.algoMaxLimit', {max: alMax})}
              </span>
              <div className="grow"></div>
              <span className={'cn-state ' + alStateCls} id="alState">{alState}</span>
              <button data-glassbtn id="alWeb" style={{height: 38}} onClick={onAlgoWeb}>{t('cfg.webBoxBtn')}</button>
              <button data-goldbtn id="alSave" style={{height: 38, padding: '0 18px'}} onClick={onAlgoSave}>{t('cfg.loadAlgosBtn')}</button>
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
              <span className="l">{t('cfg.platform', {slot: s})}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- tgPanel (fixed top-level) ---- */}
      {tgPanel && (
        <div id="tgPanel" className="tg-panel" style={{left: tgPanelPos.left, top: tgPanelPos.top}}
             onClick={e => e.stopPropagation()}>
          <div className="tg-panel-h">{t('cfg.tgGroupsTitle')}</div>
          <div id="tgGroups" className="tg-groups">{renderTgGroups()}</div>
          <div className="field" style={{marginTop: 10}}>
            <label>{t('cfg.tgAddManual')}</label>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <input id="tgChatManual" className="mono" placeholder={t('cfg.tgManualPlaceholder')} autoComplete="off"
                     style={{flex: 1, minWidth: 0}} value={tgManual}
                     onChange={e => setTgManual(e.target.value)} />
              <button data-glassbtn id="tgAdd" style={{height: 36, padding: '0 14px', borderRadius: 12, flex: 'none'}}
                      onClick={onTgAdd}>{t('common.add')}</button>
            </div>
          </div>
          <div className="tg-panel-f">
            <button data-glassbtn id="tgTest" style={{height: 36}} onClick={onTgTest}>{t('cfg.sendTest')}</button>
            <button data-glassbtn id="tgClose" style={{height: 36, padding: '0 14px'}} onClick={() => setTgPanel(false)}>{t('common.close')}</button>
            <button data-goldbtn id="tgSave" style={{height: 36, padding: '0 18px'}} onClick={onTgSave}>{t('common.save')}</button>
          </div>
        </div>
      )}
    </section>
  );
}