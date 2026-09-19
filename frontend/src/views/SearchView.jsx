import React, {useState, useEffect, useRef, useCallback} from 'react';
import {createPortal} from 'react-dom';
import {BASE, jget, post} from '../api/client.js';
import { useTranslation } from '../i18n/index.jsx';

/**
 * SearchView — "Tìm kiếm nâng cao" (port index.html #v-search + ui.js search section).
 *
 * Tab Behavioral Data (POST /aibox/search/behavior) và Face Data (POST /aibox/search/facecap),
 * lọc theo camera / từ-đến / kết quả xử lý / match (+ face: tên, id, gender, age, glasses,
 * mask; behavior: loại alarm + đối tượng). Toolbar Select This Page / Delete / Export,
 * Grid|List, pager riêng, modal chi tiết alarm + modal Export Data.
 *
 * Trong MOCK_DATA=1: danh sách camera nạp từ /api/cameras, loại alarm từ /api/algo/all
 * (đều có dữ liệu giả hợp lệ); nếu box không trả search/behavior|facecap thì rơi về nguồn
 * /api/alarms để lưới vẫn hiện nội dung khi test offline.
 */

// ---- Bảng tên alarm (phụ lục ALGO_VI, ai.js) — subset hay dùng + fallback mã gốc.
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
  ShipDetection: 'Tàu thuyền',
  SurfaceWaterDetection: 'Ngập nước mặt đường',
  TrafficParameters: 'Thông số giao thông',
  TrafficParameter: 'Thông số giao thông',
};
const algoName = (t, m, fromBox) => {
  if (fromBox) return fromBox;
  const tr = t?.('algos.' + m);
  if (tr && tr !== ('algos.' + m)) return tr;
  return ALGO_VI[m] || m;
};

// Dải số trang cho pager: tối đa 7 ô, luôn giữ trang 1 / trang cuối, chèn '…'
// khi bị ngắt (122 trang -> "1 … 59 60 61 … 122").
const pageWindow = (cur, n) => {
  if (n <= 7) return Array.from({length: n}, (_, i) => i + 1);
  const a = Math.max(2, Math.min(cur - 1, n - 4));
  const b = Math.min(n - 1, Math.max(cur + 1, 5));
  const out = [1];
  if (a > 2) out.push('…');
  for (let i = a; i <= b; i++) out.push(i);
  if (b < n - 1) out.push('…');
  out.push(n);
  return out;
};

// ---- Bảng hằng (port ui.js:2327-2341).
// status: 0=Unhandled, 1=True Alarm, 2=False Alarm, 3=Irrelevant (box enum).
const SRC_STATUS = (t) => [
  ['0', t ? t('search.statusUnhandled') : 'Unhandled'],
  ['1', t ? t('search.statusTrueAlarm') : 'True Alarm'],
  ['2', t ? t('search.statusFalseAlarm') : 'False Alarm'],
  ['3', t ? t('search.statusIrrelevant') : 'Irrelevant']
];
const SRC_ENDPOINT = {behavior: 'search/behavior', face: 'search/facecap'};
const SRC_OBJ = (t) => ({
  0: t ? t('search.objPerson') : 'Người',
  1: t ? t('search.objPerson') : 'Người',
  2: t ? t('search.objMotorVehicle') : 'Phương tiện có động cơ',
  3: t ? t('search.objNonMotorVehicle') : 'Phương tiện không động cơ'
});
const SRC_FOBJ = (t) => [
  [1, t ? t('search.objPerson') : 'Người'],
  [2, t ? t('search.objMotorVehicle') : 'Phương tiện có động cơ'],
  [3, t ? t('search.objNonMotorVehicle') : 'Phương tiện không động cơ']
];
const SRC_FGENDER = (t) => [
  ['0', t ? t('search.genderAll') : 'All'],
  ['1', t ? t('search.genderMale') : 'Male'],
  ['2', t ? t('search.genderFemale') : 'Female'],
  ['3', t ? t('search.genderUnknown') : 'Unknown']
];
const SRC_FAGE = (t) => [
  ['0', t ? t('search.ageAll') : 'All'],
  ['1', t ? t('search.ageChild') : 'Child'],
  ['2', t ? t('search.ageJuvenile') : 'Juvenile'],
  ['3', t ? t('search.ageTeenager') : 'Teenager'],
  ['4', t ? t('search.ageMiddleAge') : 'Middle age'],
  ['5', t ? t('search.ageSenior') : 'Senior']
];
const SRC_FGLASSES = (t) => [
  ['0', t ? t('search.glassesAll') : 'All'],
  ['1', t ? t('search.glassesYes') : 'Yes'],
  ['2', t ? t('search.glassesNo') : 'No']
];
const SRC_FMASK = (t) => [
  ['0', t ? t('search.maskAll') : 'All'],
  ['1', t ? t('search.maskYes') : 'Yes'],
  ['2', t ? t('search.maskNo') : 'No']
];

// ---- Helpers.
const dtLocal = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// Lịch 24h cho ô Từ/Đến: native datetime-local theo locale trình duyệt nên có thể
// hiện AM/PM; ta tự render text "YYYY-MM-DD HH:mm:ss" cố định 24h + picker riêng.
const dtToText = v => v ? v.replace('T', ' ') : '';
const dtFromText = t => {              // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DDTHH:mm:ss"
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(t || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
};
const dtParse = v => {                 // giá trị "YYYY-MM-DDTHH:mm:ss" -> Date local
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};
const srcPic = x => libImg(x.big_picture_url || x.small_picture_url);
const libImg = p => {
  const q = String(p || '').split('?')[1];
  return q ? new URL(BASE + 'aibox/picture?' + q, window.location.href).href : null;
};
const fmtTime = t => {
  const d = t ? new Date(t * 1000) : null;
  return d && !isNaN(d) ? d.toLocaleString() : '';
};

/** Dropdown bấm mở (Camera/Loại alarm/Đối tượng/Kết quả xử lý = nhiều lựa chọn;
 *  Match/Gender/Age/Glasses/Mask = một lựa chọn). Panel position:fixed -> không bị
 *  .view-wrap cắt. `open` của mỗi drop thì đóng các drop khác. */
function SrcDrop({id, opts, single, openId, onToggle, onChange, init, allLabel = 'Tất cả', selectedLabel = 'đã chọn'}) {
  const [state, setState] = useState(() => new Set(opts.map(o => String(o.value))));
  const [sval, setSval] = useState(single ? String(opts[0]?.value) : null);
  const [open, setOpen] = useState(false);
  const trigRef = useRef(null);
  const panelRef = useRef(null);
  const n = opts.length;
  const stateRef = useRef(state);
  stateRef.current = state;
  const svalRef = useRef(sval);
  svalRef.current = sval;
  const singleRef = useRef(single);
  singleRef.current = single;

  // opts tải bất đồng bộ (camera/algo nạp sau) -> multi-select mặc định chọn TẤT CẢ
  // mỗi khi có giá trị mới xuất hiện. SrcDrop giữ state đã có, chỉ thêm giá trị lạ.
  useEffect(() => {
    if (single) return;
    setState(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const o of opts) {
        const v = String(o.value);
        if (!next.has(v)) { next.add(v); changed = true; }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  // expose getters cho parent (đọc khi build query / export)
  useEffect(() => {
    if (typeof init === 'function') {
      init(id, () => [...stateRef.current].filter(Boolean), () => svalRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init, id, opts.length]);

  // khi openId thay đổi: đóng nếu không phải mình
  useEffect(() => {
    if (open && openId !== id) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, id]);

  // bấm ra ngoài panel/trigger -> đóng
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (trigRef.current && trigRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const pos = () => {
      const r = trigRef.current.getBoundingClientRect();
      const panel = panelRef.current;
      if (!panel) return;
      const estH = Math.min(panel.scrollHeight || 40, 280);
      const openUp = (r.bottom + estH > window.innerHeight) && (r.top - estH > 8);
      panel.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
      if (openUp) {
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        panel.classList.add('up');
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (r.bottom + 6) + 'px';
        panel.classList.remove('up');
      }
    };
    pos();
    window.addEventListener('resize', pos);
    return () => window.removeEventListener('resize', pos);
  }, [open]);

  const trigger = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    onToggle(id);
  };

  const label = single
    ? (opts.find(o => String(o.value) === sval) || {}).label || ''
    : (state.size === n ? `${allLabel} (${n})` : `${state.size} ${selectedLabel}`);

  const setAll = v => {
    const next = new Set();
    if (v) opts.forEach(o => next.add(String(o.value)));
    setState(next);
    onChange(single ? sval : [...next]);
  };

  const toggleVal = (v, checked) => {
    const next = new Set(state);
    if (checked) next.add(v); else next.delete(v);
    setState(next);
    onChange([...next]);
  };

  return (
    <div className={'src-drop' + (open ? ' open' : '')} id={id}>
      <button
        ref={trigRef}
        type="button"
        className={'src-drop-trig' + (open ? ' open' : '')}
        onClick={trigger}
      >
        <span className="cnt">{label}</span>
        <span className="caret">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="src-drop-panel"
          style={{position: 'fixed', zIndex: 1000}}
          onClick={e => e.stopPropagation()}
        >
          {!single && (
            <label className="all">
              <input
                type="checkbox"
                checked={state.size === n}
                onChange={e => setAll(e.target.checked)}
              />
              <span>{allLabel} ({n})</span>
            </label>
          )}
          {opts.map(o => {
            const v = String(o.value);
            return (
              <label key={v}>
                {single ? (
                  <input
                    type="radio"
                    name={'drop_' + id}
                    value={v}
                    checked={v === sval}
                    onChange={() => { setSval(v); setOpen(false); onChange(v); }}
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={state.has(v)}
                    onChange={e => toggleVal(v, e.target.checked)}
                  />
                )}
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

/** Ô ngày-giờ 24h (không AM/PM) cho Từ/Đến: text "YYYY-MM-DD HH:mm:ss" + popover
 *  date picker (native, không AM/PM) + 3 select giờ/phút/giây 24h. */
function DTInput({id, value, onChange}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(dtToText(value));
  const rootRef = useRef(null);
  const panelRef = useRef(null);

  // value đổi từ ngoài (mặc định 00:00 / 23:59:59 khi nạp camera) -> đồng bộ text
  useEffect(() => { setText(dtToText(value)); }, [value]);

  // popover nằm cố định + bấm ngoài thì đóng (panel nối vào body để khỏi bị .view-wrap cắt)
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  // đặt vị trí cố định sát trigger (đóng xuống hoặc lên khi dưới hết chỗ)
  useEffect(() => {
    if (!open) return undefined;
    const pos = () => {
      const r = rootRef.current && rootRef.current.getBoundingClientRect();
      const panel = panelRef.current;
      if (!r || !panel) return;
      const estH = panel.scrollHeight || 150;
      const openUp = (r.bottom + estH > window.innerHeight) && (r.top - estH > 8);
      panel.style.left = Math.min(r.left, window.innerWidth - 230) + 'px';
      if (openUp) {
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (r.bottom + 6) + 'px';
      }
    };
    pos();
    window.addEventListener('resize', pos);
    return () => window.removeEventListener('resize', pos);
  }, [open]);

  const d = dtParse(value);
  const yy = d ? d.getFullYear() : new Date().getFullYear();
  const mm = d ? d.getMonth() : new Date().getMonth();
  const dd = d ? d.getDate() : new Date().getDate();
  const hh = d ? d.getHours() : 0;
  const mi = d ? d.getMinutes() : 0;
  const ss = d ? d.getSeconds() : 0;
  const p = n => String(n).padStart(2, '0');

  const build = (y, mo, day, h, m, s) =>
    dtLocal(new Date(y, mo, day, h, m, s));

  const setPart = (part, val) => {
    const num = +val;
    let next;
    if (part === 'date') {
      const [Y, M, D] = val.split('-').map(Number);
      next = build(Y, M - 1, D, hh, mi, ss);
    } else if (part === 'h') next = build(yy, mm, dd, num, mi, ss);
    else if (part === 'm') next = build(yy, mm, dd, hh, num, ss);
    else next = build(yy, mm, dd, hh, mi, num);
    onChange(next);
    setText(dtToText(next));
  };

  return (
    <div className={'dt-inp' + (open ? ' open' : '')} id={id} ref={rootRef}>
      <input
        type="text"
        className="dt-text"
        value={text}
        placeholder="YYYY-MM-DD HH:mm:ss"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        onChange={e => {
          const t = e.target.value;
          setText(t);
          const v = dtFromText(t);
          if (v) onChange(v);
        }}
      />
      <button type="button" className="dt-caret" tabIndex={-1}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>▾</button>
      {open && createPortal(
        <div className="dt-panel" ref={panelRef} style={{position: 'fixed', zIndex: 1000}}
          onClick={e => e.stopPropagation()}>
          <input
            type="date"
            value={`${yy}-${p(mm + 1)}-${p(dd)}`}
            onChange={e => e.target.value && setPart('date', e.target.value)}
          />
          <div className="dt-row">
            <select value={hh} onChange={e => setPart('h', e.target.value)}>
              {Array.from({length: 24}, (_, i) => <option key={i} value={i}>{p(i)}</option>)}
            </select>
            <span>:</span>
            <select value={mi} onChange={e => setPart('m', e.target.value)}>
              {Array.from({length: 60}, (_, i) => <option key={i} value={i}>{p(i)}</option>)}
            </select>
            <span>:</span>
            <select value={ss} onChange={e => setPart('s', e.target.value)}>
              {Array.from({length: 60}, (_, i) => <option key={i} value={i}>{p(i)}</option>)}
            </select>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/** Toast nhỏ trong view (port toast của vanilla — tự chứa, không đụng shared). */
function useToast() {
  const [t, setT] = useState(null);
  const show = useCallback((sev, title) => {
    setT({sev, title});
  }, []);
  useEffect(() => {
    if (!t) return undefined;
    const h = setTimeout(() => setT(null), 2600);
    return () => clearTimeout(h);
  }, [t]);
  return [t, show];
}

export default function SearchView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('behavior');       // 'behavior' | 'face'
  const [view, setView] = useState('grid');          // 'grid' | 'list'
  const [cams, setCams] = useState([]);              // [{id, name}]
  const [algos, setAlgos] = useState([]);            // [{id, name}]
  const [rows, setRows] = useState([]);              // alarm của trang hiện tại
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pagesize = 10;
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(new Set());         // các alarm_id đã chọn
  const [openId, setOpenId] = useState(null);        // drop đang mở
  const [busy, setBusy] = useState(false);           // delete/export đang chạy
  const [modal, setModal] = useState(null);          // {mode:'view'|'edit', row}
  const [showExport, setShowExport] = useState(false);
  const [expStatus, setExpStatus] = useState(t('search.statusNotStarted'));
  const [expType, setExpType] = useState('page');
  const [expImg, setExpImg] = useState('1');
  const [expVid, setExpVid] = useState('1');
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');
  const [fName, setFName] = useState('');
  const [fId, setFId] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // refs cho drop values (đọc khi build query / export)
  const dropRef = useRef({});
  const setDrop = useCallback((k, getVals, getVal) => {
    dropRef.current[k] = {getVals, getVal};
  }, []);
  const qRef = useRef(null);      // query search đang chạy (để Refresh / Export)
  const rowsRef = useRef([]);
  rowsRef.current = rows;

  const [toast, toastShow] = useToast();

  // nạp camera + algo khi vào view (mock-aware: /api/cameras, /api/algo/all)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cj = await jget(BASE + 'api/cameras', 8000);
        if (!alive) return;
        const cl = (cj.data || []).filter(c => c.channel_id !== undefined);
        setCams(cl.map(c => ({id: c.channel_id, name: c.name || ('CH' + c.channel_id)})));
      } catch (e) {
        // box chưa cấu hình — bỏ camera (mặc định rỗng)
        if (alive) setCams([]);
      }
    })();
    (async () => {
      try {
        const aj = await jget(BASE + 'api/algo/all', 8000);
        if (!alive) return;
        // Chỉ các thuật toán ĐANG BẬT (loaded), không phải toàn bộ 93 supported —
        // như box: dropdown tìm kiếm chỉ liệt kê algo đang hoạt động.
        const sup = ((aj.data || {}).loaded || [])
          .filter(a => a !== 'AreaRuleData')
          .map(a => {
            const vi = algoName(t, a);
            // Nhãn như box: "EnterArea - Vào vùng". Bỏ lặp khi không có tên VN.
            const label = vi && vi !== a ? `${a} - ${vi}` : a;
            return {id: a, name: label};
          });
        setAlgos(sup);
      } catch (e) {
        if (alive) setAlgos([]);
      }
    })();
    return () => { alive = false; };
  }, [t]);

  // mặc định: full ngày hôm nay (từ 00:00 → bây giờ) khi có camera — như box
  useEffect(() => {
    if (cams.length) {
      // Mặc định: cả ngày hôm nay 00:00:00 → 23:59:59 (không theo giờ hiện tại).
      const now = new Date();
      const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
      setToVal(dtLocal(new Date(y, mo, d, 23, 59, 59)));
      setFromVal(dtLocal(new Date(y, mo, d, 0, 0, 0)));
    }
  }, [cams.length]);

  const srcBuildQuery = (pg) => {
    const d = dropRef.current;
    const camsVal = (d.cams?.getVals?.() || []).map(Number).filter(n => !isNaN(n));
    const p2s = v => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
    // Fallback khi ô trống: mặc định full ngày hôm nay 00:00:00 → 23:59:59
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let st = p2s(fromVal) || Math.floor(dayStart.getTime() / 1000);
    let et = p2s(toVal) || Math.floor(dayEnd.getTime() / 1000);
    if (et <= st) et = st + 3600;
    if (!camsVal.length) return null;
    const handle_status = (d.st?.getVals?.() || []).map(Number);
    const match_type = Number(d.match?.getVal?.() ?? '999') || 999;
    const faceQ = tab === 'face' ? {
      name: fName.trim(),
      id_number: fId.trim(),
      gender: Number(d.gender?.getVal?.() ?? '0'),
      age: Number(d.age?.getVal?.() ?? '0'),
      glasses: Number(d.glasses?.getVal?.() ?? '0'),
      mask: Number(d.mask?.getVal?.() ?? '0'),
    } : null;
    const behQ = tab === 'behavior' ? {
      algo_model: (d.algos?.getVals?.() || []).filter(a => a !== 'AreaRuleData'),
      object_type: (d.obj?.getVals?.() || []).map(Number),
    } : null;
    return {page: pg || page, pagesize, channel_id: camsVal, start_time: st, end_time: et,
            handle_status, match_type, ...(behQ || {}), ...(faceQ || {})};
  };

  // adapter mock: /api/alarms -> row dạng search (nếu box không trả search).
  const mockFallbackRows = async q => {
    try {
      const j = await jget(BASE + 'api/alarms', 6000);
      const st = q?.start_time || 0;
      const et = q?.end_time || Infinity;
      const chs = (q?.channel_id || []).map(Number);
      const pg = Math.max(1, Number(q?.page) || 1);
      const ps = Number(q?.pagesize) || pagesize;
      const inRange = (j.data || [])
        .filter(a => a.event_id != null && String(a.event_id) !== ''
                     && a.channel_id != null
                     && (a.ts || 0) >= st && (a.ts || 0) <= et
                     && (!chs.length || chs.includes(Number(a.channel_id))))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const total = inRange.length;
      const list = inRange.slice((pg - 1) * ps, pg * ps);
      return {
        total,
        list: list.map(a => ({
        alarm_id: a.event_id,
        status: 0,
        algo_model: a.algo_model,
        channel_id: a.channel_id,
        channel_name: a.channel_name || ('CH' + a.channel_id),
        capture_time: a.ts,
        video_url: a.video_url || '',
        big_picture_url: (a.images || [])[0] || null,
        small_picture_url: null,
        object_list: (a.capture_info || []).map(ci => ({object_type: ci.object_type === 'person' ? 1 : 0})),
        })),
      };
    } catch {
      return {total: 0, list: []};
    }
  };

  const loadSearch = useCallback(async (qOverride, pg) => {
    const q = qOverride || srcBuildQuery(pg);
    if (!q) { toastShow(t('common.warning'), t('search.selectAtLeastOneCam')); return; }
    if (pg) setPage(pg);
    qRef.current = q;
    setSel(new Set());
    setSearching(true);
    try {
      let data = await post(SRC_ENDPOINT[tab], q);
      let list = (data || {}).list || [];
      if (!data || typeof data.total === 'undefined') {
        const fb = await mockFallbackRows(q);
        list = fb.list;
        setTotal(fb.total);
      } else {
        setTotal((data.total) || 0);
      }
      list = [...list].sort((a, b) => (b.capture_time || 0) - (a.capture_time || 0));
      setRows(list);
    } catch (e) {
      const fb = await mockFallbackRows(q);
      setRows(fb.list);
      setTotal(fb.total);
      if (!fb.list.length) toastShow(t('common.error'), t('search.searchFailed') + ': ' + (e.message || ''));
    } finally {
      setSearching(false);
    }
  }, [tab, page, fromVal, toVal, fName, fId, t]);

  // tự tìm ngay khi mở lần đầu
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    if (!cams.length) return;
    if (!fromVal || !toVal) return;
    didInit.current = true;
    loadSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cams.length, fromVal, toVal]);

  const onTab = k => {
    if (tab === k) return;
    setTab(k);
    setSel(new Set());
    setRows([]);
    setTotal(0);
    setPage(1);
  };

  const tabRef = useRef(tab);
  useEffect(() => {
    if (tabRef.current === tab) return;
    tabRef.current = tab;
    if (!qRef.current) return;
    loadSearch(null, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const pages = Math.max(1, Math.ceil(total / pagesize));
  const curPage = Math.min(page, pages);
  const goPage = p => {
    if (p < 1 || p > pages || p === curPage) return;
    setPage(p);
    loadSearch({...qRef.current, page: p});
  };

  const onSelectCard = id => {
    setSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectThisPage = () => {
    setSel(prev => {
      const next = new Set(prev);
      const all = rows.every(r => next.has(r.alarm_id));
      if (all) rows.forEach(r => next.delete(r.alarm_id));
      else rows.forEach(r => next.add(r.alarm_id));
      return next;
    });
  };

  const onDelete = async () => {
    const ids = [...sel];
    if (!ids.length) { toastShow(t('common.warning'), t('search.selectAtLeastOneAlarm')); return; }
    if (!window.confirm(t('search.confirmDeleteSelected', {count: ids.length}))) return;
    setDeleting(true);
    try {
      const qry = {QueryInfos: [{QryType: 201, QryCondition: 7, QryData: ids.join(',')}], Num: ids.length};
      const r = await (await fetch(BASE + 'aibox/dao/delete', {
        method: 'DELETE', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(qry), signal: AbortSignal.timeout(25000),
      })).json();
      if (r.status_code !== 0 && r.code !== 0) throw new Error(r.msg || 'code ' + r.status_code);
      toastShow('OK', t('search.deletedCount', {count: ids.length}));
      setSel(new Set());
      if (qRef.current) loadSearch(qRef.current);
    } catch (e) {
      toastShow(t('common.error'), t('search.deleteFailed') + ': ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  // export polling
  const onExport = async () => {
    if (expType === 'sel' && !sel.size) { toastShow(t('common.warning'), t('search.selectAtLeastOneAlarm')); return; }
    if (expType === 'page' && !rowsRef.current.length) { toastShow(t('common.warning'), t('search.noResultsToExport')); return; }
    setShowExport(true);
    setExpStatus(t('search.statusNotStarted'));
  };

  const onExportGo = async () => {
    const q = qRef.current || srcBuildQuery();
    if (!q) return;
    setExporting(true);
    const isSel = expType === 'sel';
    const type = tab === 'face' ? 1 : 0;
    const sw = (Number(expVid) ? 1 : 0) + (Number(expImg) ? 2 : 0);
    const body = {...q, Type: type, Switch: sw};
    body.AlarmID = (isSel
      ? [...sel].map(Number).filter(n => !isNaN(n))
      : (rowsRef.current || []).map(r => Number(r.alarm_id)).filter(n => !isNaN(n)))
      .sort((a, b) => b - a);
    body.pagesize = body.AlarmID.length;
    try {
      setExpStatus(t('search.statusSending'));
      await post('search/export', body);
      let url = null;
      for (let i = 0; i < 30; i++) {
        const p = await (await fetch(BASE + 'aibox/export/progress')).json();
        const d = (p.data || {});
        if (d.ExportStatus === 0 && d.URL) { url = d.URL; break; }
        setExpStatus(`${t('search.statusExporting')} (${i + 1}/30)`);
        await new Promise(res => setTimeout(res, 2000));
      }
      if (!url) throw new Error('box không tạo được file export');
      setExpStatus(t('search.statusDownloading'));
      const href = url.startsWith('http') ? url : (BASE + url.replace(/^\//, ''));
      const m = /([^/?#]+)(?:\?|#|$)/.exec(url);
      const fn = m ? m[1] : `export-${tab}.tar`;
      const dl = /\.tar$/i.test(fn) ? fn : fn.replace(/\.[^.]*$/, '') + '.tar';
      const a = document.createElement('a');
      a.href = href; a.download = dl;
      document.body.appendChild(a); a.click(); a.remove();
      toastShow('OK', t('search.exportSuccess'));
      setShowExport(false);
      setExpStatus(t('search.statusNotStarted'));
    } catch (e) {
      setExpStatus('');
      toastShow(t('common.error'), t('search.exportFailed') + ': ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const closeExport = () => { setShowExport(false); setExpStatus(t('search.statusNotStarted')); };

  const playClip = async x => {
    const m = /\/c(\d+)\/b(\d+)\/e(\d+)/.exec(x.video_url || '');
    if (!m) { toastShow(t('common.warning'), t('search.noClipAvailable')); return; }
    const url = `${BASE}aibox/video?ChlId=${m[1]}&StartTime=${m[2]}&EndTime=${m[3]}`;
    try {
      const blob = await (await fetch(url, {signal: AbortSignal.timeout(30000)})).blob();
      if (!blob || !blob.size) throw new Error('box không trả clip');
      window.__searchClip = URL.createObjectURL(blob);
      setModal({mode: 'clip', row: x});
    } catch (e) {
      toastShow(t('common.error'), t('search.clipLoadFailed') + ': ' + e.message);
    }
  };

  const EXP_TYPE_LBL = {page: t('search.exportThisPage'), sel: t('search.exportSelected')};
  const EXP_YN_LBL = {'1': t('search.yes'), '0': t('search.no')};

  // ---------- Render ----------
  return (
    <section className="view" id="v-search">
      <div className="view-wrap" style={{padding: '18px'}}>
        {/* Thanh lọc */}
        <div className="lib-panel" id="srcFilterPanel" style={{marginBottom: 14, padding: '14px 16px', minHeight: 0, alignSelf: 'flex-start', width: '100%'}}>
          <div className="src-head">
            <div data-glass data-seg className="seg" id="srcTabs" style={{flex: 'none', padding: 4, borderRadius: 14,
              background: 'linear-gradient(168deg,rgba(255,255,255,.10) 0%,rgba(213,194,149,.12) 48%,rgba(213,194,149,.20) 100%)',
              border: '1px solid rgba(213,194,149,.34)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30),0 8px 22px rgba(0,0,0,.35)'}}>
              <button data-src-tab="behavior" className={tab === 'behavior' ? 'on' : ''}
                      onClick={() => onTab('behavior')}>{t('search.tabBehavior')}</button>
              <button data-src-tab="face" className={tab === 'face' ? 'on' : ''}
                      onClick={() => onTab('face')}>{t('search.tabFace')}</button>
            </div>
            <div className="grow" />
            <span className="view-sub" id="srcSelHint" hidden={sel.size === 0}>
              {t('search.selectedItemsCount', {count: sel.size})}
            </span>
            <button data-glassbtn id="srcSelPage" style={{height: 32, padding: '0 13px', borderRadius: 11}} onClick={selectThisPage}>{t('search.selectThisPage')}</button>
            <button data-glassbtn id="srcDelete" style={{height: 32, padding: '0 13px', borderRadius: 11}} title={t('search.deleteSelectedHint')}
              disabled={deleting} onClick={onDelete}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}>
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
              </svg>
              <span>{t('search.delete')}</span>
            </button>
            <button data-glassbtn id="srcExport" style={{height: 32, padding: '0 13px', borderRadius: 11}} title={t('search.exportHint')} onClick={onExport}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 13, height: 13}}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span>{t('search.export')}</span>
            </button>
          </div>
          <div className="src-filters">
            <div className="src-f">
              <span className="view-sub">{t('search.camera')}</span>
              <SrcDrop id="cams" opts={cams.map(c => ({value: String(c.id), label: c.name}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} allLabel={t('search.all')} selectedLabel={t('search.selected')} />
            </div>
            {/* behavior-only: Loại alarm + Đối tượng */}
            <div className="src-f" style={{display: tab === 'behavior' ? 'flex' : 'none'}}>
              <span className="view-sub">{t('search.alarmType')}</span>
              <SrcDrop id="algos" opts={algos.map(a => ({value: a.id, label: a.name}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} allLabel={t('search.all')} selectedLabel={t('search.selected')} />
            </div>
            <div className="src-f" style={{display: tab === 'behavior' ? 'flex' : 'none'}}>
              <span className="view-sub">{t('search.object')}</span>
              <SrcDrop id="obj" opts={SRC_FOBJ(t).map(([v, l]) => ({value: String(v), label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} allLabel={t('search.all')} selectedLabel={t('search.selected')} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.result')}</span>
              <SrcDrop id="st" opts={SRC_STATUS(t).map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} allLabel={t('search.all')} selectedLabel={t('search.selected')} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.from')}</span>
              <DTInput id="searchFrom" value={fromVal} onChange={setFromVal} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.to')}</span>
              <DTInput id="searchTo" value={toVal} onChange={setToVal} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.match')}</span>
              <SrcDrop id="match" single opts={[['999', t('search.genderAll')], ['1', t('search.matchTrue')], ['2', t('search.matchFalse')]].map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} />
            </div>
            <button data-goldbtn id="searchGo" style={{height: 38, padding: '0 20px', borderRadius: 14}}
              onClick={() => loadSearch(null, 1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 14, height: 14}}>
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-4.5-4.5" />
              </svg>
              <span>{t('search.searchBtn')}</span>
            </button>
          </div>

          {/* face-only: Tên / ID / Gender / Age / Glasses / Mask */}
          <div id="srcFaceFilters" className="src-filters" style={{display: tab === 'face' ? 'grid' : 'none'}}>
            <div className="src-f">
              <span className="view-sub">{t('search.name')}</span>
              <input type="text" id="srcFName" placeholder={t('search.namePlaceholder')} value={fName} onChange={e => setFName(e.target.value)}
                style={{height: 38, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(213,194,149,.30)', borderRadius: 12, colorScheme: 'dark', color: 'inherit', padding: '0 10px'}} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.idNo')}</span>
              <input type="text" id="srcFId" placeholder={t('search.idPlaceholder')} value={fId} onChange={e => setFId(e.target.value)}
                style={{height: 38, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(213,194,149,.30)', borderRadius: 12, colorScheme: 'dark', color: 'inherit', padding: '0 10px'}} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.gender')}</span>
              <SrcDrop id="gender" single opts={SRC_FGENDER(t).map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.age')}</span>
              <SrcDrop id="age" single opts={SRC_FAGE(t).map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.glasses')}</span>
              <SrcDrop id="glasses" single opts={SRC_FGLASSES(t).map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} />
            </div>
            <div className="src-f">
              <span className="view-sub">{t('search.mask')}</span>
              <SrcDrop id="mask" single opts={SRC_FMASK(t).map(([v, l]) => ({value: v, label: l}))}
                openId={openId} onToggle={setOpenId} onChange={() => {}} init={setDrop} />
            </div>
          </div>
        </div>

        {/* Lưới kết quả */}
        <div className="nosb" style={{flex: 1, minHeight: 0, overflow: 'auto'}}>
          <div className="lib-panel">
            {rows.length === 0 ? (
              <div className="lib-empty" id="searchEmpty">
                <svg viewBox="0 0 24 24" fill="none" stroke="rgba(229,229,234,.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width: 30, height: 30}}>
                  <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-4.5-4.5" />
                </svg>
                <span className="t1" id="searchEmptyT1">{total ? t('search.noDataThisPage') : t('search.noResults')}</span>
                <span className="t2" id="searchEmptyT2">{t('search.emptySub')}</span>
              </div>
            ) : (
              <div className={'lib-grid' + (view === 'list' ? ' list' : '')} id="searchGrid"
                style={view === 'grid' ? {gridTemplateColumns: 'repeat(5,1fr)'} : undefined}>
                {rows.map((x, i) => {
                  const stList = SRC_STATUS(t);
                  const st = stList.find(s => s[0] === String(x.status));
                  const stCls = Number(x.status) === 0 ? 'err' : 'ok';
                  const objMap = SRC_OBJ(t);
                  const obj = objMap[(x.object_list || [{}])[0]?.object_type];
                  const url = srcPic(x);
                  const d = x.capture_time ? new Date(x.capture_time * 1000) : null;
                  const isSel = sel.has(x.alarm_id);
                  const kind = [algoName(t, x.algo_model), obj].filter(Boolean).join(' · ');
                  return (
                    <div key={x.alarm_id ?? i} className={'lib-card src-card' + (isSel ? ' src-sel' : '')}
                      data-alarm={x.alarm_id} onClick={() => onSelectCard(x.alarm_id)}>
                      <div className="lib-img" style={url ? {backgroundImage: 'url(' + JSON.stringify(url) + ')'} : undefined}>
                        <span className={'lib-ms ' + stCls}>{st ? st[1] : '#' + x.status}</span>
                        <span className="lib-kind">{kind}</span>
                        <div className="src-actions">
                          <button className="src-a" data-act="view" title={t('search.view')} onClick={e => { e.stopPropagation(); setModal({mode: 'view', row: x}); }}>{t('search.view')}</button>
                          <button className="src-a" data-act="edit" title={t('search.editStatus')} onClick={e => { e.stopPropagation(); setModal({mode: 'edit', row: x}); }}>{t('search.edit')}</button>
                          <button className="src-a" data-act="video" title={t('search.viewClip')} onClick={e => { e.stopPropagation(); playClip(x); }}>{t('search.video')}</button>
                        </div>
                      </div>
                      <div className="lib-meta">
                        <span className="lib-name">{x.channel_name || ('CH' + x.channel_id)}</span>
                        <span className="lib-sub">{d && !isNaN(d) ? d.toLocaleString() : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Pager — cuối panel thẻ kết quả */}
            <div className="pager" id="searchPager" hidden={pages <= 1} style={{justifyContent: 'center', paddingTop: 12}}>
              <div className="mid">
                <button data-pgctrl data-pg-dir id="searchPgPrev" title={t('lib.prevPage')} aria-label={t('lib.prevPage')}
                  className={curPage <= 1 ? 'dis' : ''} onClick={() => goPage(curPage - 1)}>‹</button>
                <span id="searchPgNums" style={{display: 'flex', alignItems: 'center', gap: 2}}>
                  {pageWindow(curPage, pages).map((p, i) => p === '…'
                    ? <span className="pg-gap" key={'g' + i}>…</span>
                    : <button key={p} className={'pg' + (p === curPage ? ' on' : '')}
                        aria-current={p === curPage ? 'page' : undefined}
                        aria-label={t('lib.pageNumber', {page: p})} onClick={() => goPage(p)}>{p}</button>)}
                </span>
                <button data-pgctrl data-pg-dir id="searchPgNext" title={t('lib.nextPage')} aria-label={t('lib.nextPage')}
                  className={curPage >= pages ? 'dis' : ''} onClick={() => goPage(curPage + 1)}>›</button>
                <span className="tb-div" />
                <span className="view-sub" id="searchPgInfo">{t('search.pagerInfo', {total, pages})}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal chi tiết alarm */}
      {modal && (
        <div id="searchModal" style={{position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)'}}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div data-glass style={{maxWidth: 'min(720px,92vw)', maxHeight: '92vh', overflow: 'auto', borderRadius: 18, border: '1px solid rgba(213,194,149,.34)', background: 'linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.04))', boxShadow: '0 24px 60px rgba(0,0,0,.6)', padding: 18}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap'}}>
              <span className="view-h" id="searchMdTitle" style={{fontSize: 16}}>{algoName(t, modal.row.algo_model)} · #{modal.row.alarm_id}</span>
              <div className="grow" />
              <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                <button data-glassbtn id="searchMdVideo" style={{height: 32, padding: '0 12px', borderRadius: 10}} onClick={() => playClip(modal.row)}>{t('search.viewClip')}</button>
                <button data-glassbtn id="searchMdClose" style={{height: 32, padding: '0 12px', borderRadius: 10}} onClick={() => setModal(null)}>{t('common.close')}</button>
              </div>
            </div>

            {modal.mode === 'clip' ? (
              <div id="searchMdVideoWrap" style={{marginTop: 10, textAlign: 'center'}}>
                {window.__searchClip ? (
                  <video id="searchMdVid" controls autoPlay src={window.__searchClip} style={{maxWidth: '100%', maxHeight: '40vh', borderRadius: 12, background: '#000'}} />
                ) : null}
              </div>
            ) : modal.mode === 'edit' ? (
              <EditPanel row={modal.row} onClose={() => setModal(null)} onSaved={r => {
                setRows(prev => prev.map(p => p.alarm_id === r.alarm_id ? {...p, status: r.status} : p));
                setModal(null);
              }} toastShow={toastShow} t={t} />
            ) : (
              <div>
                <div style={{textAlign: 'center'}}>
                  <img id="searchMdImg" alt="" src={srcPic(modal.row) || ''} style={{maxWidth: '100%', maxHeight: '56vh', borderRadius: 12, background: '#000'}} />
                </div>
                <div id="searchMdMeta" style={{marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4}}>
                  {(() => {
                    const st = SRC_STATUS(t).find(s => s[0] === String(modal.row.status));
                    const rowsInfo = [
                      [t('search.camera'), modal.row.channel_name || ('CH' + modal.row.channel_id)],
                      [t('search.time'), fmtTime(modal.row.capture_time)],
                      [t('search.result'), st ? st[1] : ('#' + modal.row.status)],
                    ];
                    return rowsInfo.map(([k, v]) => (
                      <div key={k} style={{display: 'flex', gap: 8}}>
                        <span className="view-sub" style={{flex: 'none', minWidth: 86}}>{k}</span><span>{v}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Export Data */}
      {showExport && (
        <div id="srcExportModal" style={{position: 'fixed', inset: 0, zIndex: 51, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)'}}
          onClick={e => { if (e.target === e.currentTarget) closeExport(); }}>
          <div data-glass style={{width: 'min(460px,92vw)', borderRadius: 20, border: '1px solid rgba(213,194,149,.40)', background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.045))', boxShadow: '0 28px 70px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.25)', padding: 0, overflow: 'hidden'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,.09)', background: 'linear-gradient(168deg,rgba(213,194,149,.16),rgba(255,255,255,.03))'}}>
              <span style={{flex: 'none', width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(168deg,rgba(213,194,149,.30),rgba(213,194,149,.12))', border: '1px solid rgba(213,194,149,.40)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width: 17, height: 17}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              </span>
              <div style={{display: 'flex', flexDirection: 'column', gap: 1}}>
                <span className="view-h" style={{fontSize: 16, lineHeight: 1.15}}>{t('search.exportTitle')}</span>
                <span className="view-sub" id="srcExpSub" style={{fontSize: 11}}>{t('search.exportSub')}</span>
              </div>
              <div className="grow" />
              <button data-glassbtn id="srcExpClose" aria-label={t('common.close')} style={{height: 30, padding: '0 10px', borderRadius: 9}} onClick={closeExport}>✕</button>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 18px', fontSize: 13}}>
              <div>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7}}>
                  <span className="view-sub" style={{fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase'}}>{t('search.exportType')}</span>
                  <span className="view-sub" id="srcExpTypeLbl" style={{fontSize: 11}}>{EXP_TYPE_LBL[expType] || ''}</span>
                </div>
                <div data-glass data-seg className="seg" id="srcExpType" style={{flex: 'none', padding: 4, borderRadius: 14, width: '100%'}}>
                  <button data-exp-type="page" className={expType === 'page' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpType('page')}>{t('search.exportThisPage')}</button>
                  <button data-exp-type="sel" className={expType === 'sel' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpType('sel')}>{t('search.exportSelected')}</button>
                </div>
              </div>

              <div>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7}}>
                  <span className="view-sub" style={{fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase'}}>{t('search.alarmImage')}</span>
                  <span className="view-sub" id="srcExpImgLbl" style={{fontSize: 11}}>{EXP_YN_LBL[expImg] || ''}</span>
                </div>
                <div data-glass data-seg className="seg" id="srcExpImg" style={{flex: 'none', padding: 4, borderRadius: 14, width: '100%'}}>
                  <button data-exp-val="1" className={expImg === '1' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpImg('1')}>{t('search.doExport')}</button>
                  <button data-exp-val="0" className={expImg === '0' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpImg('0')}>{t('search.doNotExport')}</button>
                </div>
              </div>

              <div>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7}}>
                  <span className="view-sub" style={{fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase'}}>{t('search.alarmVideo')}</span>
                  <span className="view-sub" id="srcExpVidLbl" style={{fontSize: 11}}>{EXP_YN_LBL[expVid] || ''}</span>
                </div>
                <div data-glass data-seg className="seg" id="srcExpVid" style={{flex: 'none', padding: 4, borderRadius: 14, width: '100%'}}>
                  <button data-exp-val="1" className={expVid === '1' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpVid('1')}>{t('search.doExport')}</button>
                  <button data-exp-val="0" className={expVid === '0' ? 'on' : ''} style={{flex: 1, padding: '8px 6px'}} onClick={() => setExpVid('0')}>{t('search.doNotExport')}</button>
                </div>
              </div>
            </div>

            <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,.09)', background: 'rgba(0,0,0,.14)'}}>
              <div id="srcExpStatus" className="view-sub" style={{flex: 1, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{expStatus}</div>
              <button data-glassbtn id="srcExpCancel" style={{height: 36, padding: '0 16px', borderRadius: 12}} onClick={closeExport}>{t('common.cancel')}</button>
              <button data-goldbtn id="srcExpGo" style={{height: 36, padding: '0 22px', borderRadius: 12, fontWeight: 600}} disabled={exporting} onClick={onExportGo}>{t('search.export')}</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{position: 'fixed', top: 16, right: 16, zIndex: 999,
          padding: '10px 16px', borderRadius: 12,
          background: toast.sev === 'OK' ? 'rgba(48,209,88,.18)' : (toast.sev === t('common.warning') ? 'rgba(255,159,10,.18)' : 'rgba(255,69,58,.2)'),
          border: '1px solid ' + (toast.sev === 'OK' ? 'rgba(48,209,88,.5)' : (toast.sev === t('common.warning') ? 'rgba(255,159,10,.5)' : 'rgba(255,69,58,.55)')),
          color: '#f5f5f7', fontSize: 12.5, boxShadow: '0 12px 30px rgba(0,0,0,.5)', maxWidth: 360}}>
          <b style={{marginRight: 6, color: toast.sev === 'OK' ? '#30d158' : (toast.sev === t('common.warning') ? '#ff9f0a' : '#ff6961')}}>{toast.sev}</b>
          <span>{toast.title}</span>
        </div>
      )}
    </section>
  );
}

/** Panel Edit: Channel / Alarm Type / Alarm Time + Handling Result (radio 1/2/3) + Lưu. */
function EditPanel({row, onClose, onSaved, toastShow, t}) {
  const [status, setStatus] = useState(Number(row.status));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await post('search/status/update', {id: row.alarm_id, status});
      toastShow('OK', t ? t('search.statusSaved') : 'Đã lưu kết quả xử lý');
      onSaved({...row, status});
    } catch (e) {
      toastShow(t ? t('common.error') : 'LỖI', (t ? t('search.updateFailed') : 'Cập nhật thất bại') + ': ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="searchMdEdit" style={{marginTop: 12, padding: '14px 16px', border: '1px solid rgba(213,194,149,.30)', borderRadius: 14, background: 'rgba(255,255,255,.05)'}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13}}>
        <div><span className="view-sub" style={{display: 'inline-block', minWidth: 110}}>{t ? t('search.camera') : 'Channel'}</span><span id="srcEdCh">{row.channel_name || ('CH' + row.channel_id)}</span></div>
        <div><span className="view-sub" style={{display: 'inline-block', minWidth: 110}}>{t ? t('search.alarmType') : 'Alarm Type'}</span><span id="srcEdType">{algoName(t, row.algo_model) || row.algo_model || '—'}</span></div>
        <div><span className="view-sub" style={{display: 'inline-block', minWidth: 110}}>{t ? t('search.time') : 'Alarm Time'}</span><span id="srcEdTime">{fmtTime(row.capture_time) || '—'}</span></div>
      </div>
      <div style={{marginTop: 12}} className="view-sub">{t ? t('search.result') : 'Handling Result'}</div>
      <div id="srcEdRes" style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6}}>
        {SRC_STATUS(t).map(([v, l]) => {
          if (v === '0') return null;
          return (
            <label key={v}>
              <input type="radio" name="srcEdResRadio" value={v} checked={status === Number(v)} onChange={() => setStatus(Number(v))} />
              <span>{l}</span>
            </label>
          );
        })}
      </div>
      <div style={{marginTop: 12, textAlign: 'right'}}>
        <button data-glassbtn id="srcEdSave" style={{height: 32, padding: '0 16px', borderRadius: 10}} disabled={saving} onClick={save}>{t ? t('common.save') : 'Lưu'}</button>
      </div>
    </div>
  );
}