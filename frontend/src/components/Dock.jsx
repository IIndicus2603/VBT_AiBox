import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {BASE, evKey, dedupBest} from '../api/client.js';
import useEvents from '../api/useEvents.js';
import { useTranslation } from '../i18n/index.jsx';

const DOCK_ICONS = {
  live: <path d="M4 10.5 12 4l8 6.5V20H4zM10 20v-6h4v6" />,
  log: <path d="M12 7v5l3.5 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16" />,
  lib: <path d="M4 6.5h16v12H4zM4 10.5h16M9 10.5v8" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M21 21l-4.5-4.5" />,
  cam: <path d="M3.5 7.5h11v9h-11zM14.5 11l6-3v8l-6-3" />,
  cfg: <path d="M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2M19 12a7 7 0 0 0-.1-1l1.6-1.3-1.7-2.9-1.9.8a7 7 0 0 0-1.7-1L14.8 4H9.2l-.4 2a7 7 0 0 0-1.7 1l-1.9-.8-1.7 2.9L5.1 11a7 7 0 0 0 0 2l-1.6 1.3 1.7 2.9 1.9-.8a7 7 0 0 0 1.7 1l.4 2h5.6l.4-2a7 7 0 0 0 1.7-1l1.9.8 1.7-2.9-1.6-1.3a7 7 0 0 0 .1-1" />,
};

const DOCK_KEYS = [
  {go: 'live', key: 'dock.live'},
  {go: 'log', key: 'dock.log'},
  {go: 'lib', key: 'dock.lib'},
  {go: 'search', key: 'dock.search'},
  {go: 'cam', key: 'dock.cam'},
  {go: 'cfg', key: 'dock.cfg'},
];

const activeOf = view =>
  view === 'detail' ? 'live' : view === 'ai' ? 'cam' : view;

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
};
const algoName = (t, m, fromBox) => {
  if (fromBox) return fromBox;
  const translated = t('algos.' + m);
  if (translated && translated !== ('algos.' + m)) return translated;
  return ALGO_VI[m] || m || t('dock.notifTitle');
};

const isDetect = a => a?.type != null && a.type !== 2 && a.type !== 6 && a.type !== 7
  && a?.kind !== 'sse' && a?.algo_model !== 'AreaRuleData';
const pad = n => String(n).padStart(2, '0');
const fmtTime = t => t ? `${pad(new Date(t * 1000).getHours())}:${pad(new Date(t * 1000).getMinutes())}` : '';

export default function Dock({view, onGo, unread, onEvent, onReadAll}) {
  const { t } = useTranslation();
  const active = activeOf(view);
  const [open, setOpen] = useState(false);
  const [alarms, setAlarms] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const pos = () => {
      const dock = rootRef.current && rootRef.current.getBoundingClientRect();
      const panel = panelRef.current;
      if (!dock || !panel) return;
      const estH = panel.scrollHeight || 390;
      const openUp = (dock.bottom + 10 + estH > window.innerHeight) && (dock.top - 10 - estH > 8);
      panel.style.left = Math.min(dock.right - 320, window.innerWidth - 332) + 'px';
      if (openUp) {
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - dock.top + 10) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (dock.bottom + 10) + 'px';
      }
    };
    pos();
    window.addEventListener('resize', pos);
    return () => window.removeEventListener('resize', pos);
  }, [open]);

  useEffect(() => {
    if (!open || alarms) return;
    let on = true;
    (async () => {
      try {
        const r = await fetch(BASE + 'api/alarms', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
        }).then(r => r.json());
        if (!on) return;
        const arr = (r.data || []).filter(isDetect)
          .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
        setAlarms(arr);
      } catch { if (on) setAlarms([]); }
    })();
    return () => { on = false; };
  }, [open, alarms]);

  useEvents(ev => {
    if (!ev || ev.kind === 'video') return;
    if (ev.algo_model === 'AreaRuleData') return;
    if (!isDetect(ev)) return;
    if (ev.event_id == null) return;
    setAlarms(a => {
      const cur = a || [];
      const merged = [ev, ...cur.filter(x => evKey(x) !== evKey(ev))];
      return merged.slice(0, 8);
    });
  }, []);

  const toggle = e => {
    e.stopPropagation();
    setOpen(o => !o);
  };

  const openLog = () => { setOpen(false); onGo('log'); };
  const openEvent = a => { setOpen(false); onEvent(a); };

  const markAll = () => {
    onReadAll?.();
    setAlarms(null);
  };

  return (
    <>
    <nav data-dock
         ref={rootRef}
         style={{position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', gap: 0,
                 padding: 5, borderRadius: 26, transition: 'border-radius .26s ease',
                 background: 'linear-gradient(168deg,rgba(255,255,255,.10) 0%,rgba(213,194,149,.12) 48%,rgba(213,194,149,.20) 100%)',
                 border: '1px solid rgba(213,194,149,.34)',
                 boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30),0 8px 22px rgba(0,0,0,.35)'}}>
      <span data-dockrail />
      {DOCK_KEYS.map(it => {
        const lbl = t(it.key);
        return (
          <button key={it.go} data-go={it.go} data-dockitem
                  title={lbl} className={active === it.go ? 'on' : ''}
                  style={{flex: 'none', position: 'relative'}}
                  onClick={it.go === 'log' ? toggle : () => onGo(it.go)}>
            <span data-dock-icon>
              <span data-dockgold />
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
                   strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{DOCK_ICONS[it.go]}</svg>
              {it.go === 'log' && unread > 0 && (
                <span className="badge" id="navUnread">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span data-dock-label>{lbl}</span>
          </button>
        );
      })}
    </nav>

    {/* Bảng thông báo — bấm nút Nhật ký để mở (nối vào body để không bị header cắt) */}
    {open && createPortal(
      <div className="notif-panel" ref={panelRef} style={{position: 'fixed', zIndex: 1000}}
        onClick={e => e.stopPropagation()}>
        <div className="notif-head">
          <span>{t('dock.notifTitle')}</span>
          <div className="notif-acts">
            <button type="button" className="notif-more" data-glassbtn onClick={markAll}>{t('dock.markRead')}</button>
            <button type="button" className="notif-more" data-goldbtn onClick={openLog}>{t('dock.detail')}</button>
          </div>
        </div>
        {!alarms ? (
          <div className="notif-empty">{t('dock.loading')}</div>
        ) : !alarms.length ? (
          <div className="notif-empty">{t('dock.noAlerts')}</div>
        ) : (
          <div className="notif-list nosb">
            {dedupBest(alarms).map(a => {
              const unreadOne = a.seen !== true;
              const nm = algoName(t, a.algo_model, a.algo_name);
              return (
                <div key={evKey(a)}
                     className="notif-card" onClick={() => a.event_id != null ? openEvent(a) : openLog()}>
                  <span className="notif-b">
                    <span className="notif-t">{nm}</span>
                    <span className="notif-s">{(a.channel_name || '') + (a.channel_name ? ' · ' : '') + fmtTime(a.ts)}</span>
                  </span>
                  {unreadOne && <span className="notif-unread">{t('dock.newBadge')}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>,
      document.body
    )}
    </>
  );
}