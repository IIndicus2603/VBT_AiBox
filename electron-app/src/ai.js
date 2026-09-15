/**
 * Panel cấu hình AI cho 1 camera + luồng alarm SSE.
 *
 * Ghép camera <-> channel: aibox.py đặt tên stream là `ch<channel_id>` khi sync
 * từ /channel/list, nên suy ra channel_id từ tên stream, không cần bảng map.
 *
 * Ba cạm bẫy của API được xử lý ở đây:
 *  1. /smart/update GHI ĐÈ CẢ LIST -> luôn đọc /smart/list trước rồi merge.
 *  2. /extend/* la endpoint CU, khong con trong firmware nay — smart/update da
 *     luu sensitive/report_rate. Dung goi extend/update, no tra Invalid Arguments.
 *  3. Toạ độ vùng normalize 0~10000 (không phải pixel), point_x/point_y là
 *     STRING số cách nhau bằng dấu phẩy, không phải array.
 */
// Không import từ app.js: app.js -> ui.js -> app.js là vòng, kéo ai.js vào vòng đó
// làm module này phụ thuộc thứ tự khởi tạo. Hai selector này là one-liner, tự khai.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// UI do go2rtc serve (:1984) nhung API cua box do aibox.py giu (:8090) -> phai
// tro tuyet doi khi khong cung port. aibox.py tra CORS cho truong hop nay.
export const BASE = location.port === '8090' ? '' : 'http://127.0.0.1:8090/';
// go2rtc (:1984) — doi xung voi BASE. Khong import G tu app.js: app.js -> ui.js ->
// app.js la vong, keo ai.js vao do lam module nay phu thuoc thu tu khoi tao.
const GO = location.port === '1984' ? '' : 'http://127.0.0.1:1984/';

const post = async (path, body) => {
  const r = await fetch(BASE + 'aibox/' + path, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${path}: ${j.msg || 'code ' + j.code}`);
  return j.data || {};
};

/** Firmware ECS-516S-SF-HD tra data.algo_model = mang CHUOI (94 muc) + wutong_model.
 *  Tai lieu khong cho vi du response ro rang -> chap ca mang chuoi va mang object,
 *  gop luon wutong_model neu co. Tra [{algo_model, algo_name?}]. */
export function algoList(data) {
  const d = data || {};
  const raw = [d.algo_model, d.wutong_model, d.list, d.algo_list, d.model_list]
    .filter(Array.isArray).flat();
  const seen = new Set();
  return raw
    .map(a => (typeof a === 'string' ? {algo_model: a} : a || {}))
    .filter(a => a.algo_model && !seen.has(a.algo_model) && seen.add(a.algo_model));
}

export const chIdOf = name => {
  const m = /^ch(\d+)$/.exec(name || '');
  return m ? +m[1] : null;
};

export const mergeRtsp = (original, shown, username, password) => {
  const old = /^([a-z]+:\/\/)([^:@/]+):([^@/]*)@(.+)$/i.exec(original || '');
  const next = /^([a-z]+:\/\/)(?:[^:@/]+(?::[^@/]*)?@)?(.+)$/i.exec(shown || '');
  if (!old || !next) return original || shown || '';
  return next[1] + (username || old[2]) + ':' + (password || old[3]) + '@' + next[2];
};

/** Tên hiển thị cho algo_model. Box CHỈ trả mã kỹ thuật (`/algo/list` và
 *  `/smart/list` đều không có field tên), nên bảng này phải nhúng ở client —
 *  dịch từ phụ lục 14.3, cột "Algorithm Name" của họ ECS-X5X1-SF/ECS-50XX-SF.
 *
 *  Vài mã lệch hẳn nghĩa so với tên, đừng "sửa" theo trực giác:
 *    FumesAlarmBegin        -> Khói (không phải "bắt đầu")
 *    ObjectIsRecognized     -> Nhận diện mặt
 *    AccessElevatorAlarm    -> Xe điện vào thang máy
 *    LiquidLeakDetection    -> tài liệu ghi "Water Leak" (nước, không phải chất lỏng)
 *    FreightInPassengerElevator / ElectricBicycleIntrusionDetection: tài liệu gán
 *      tên "Freight in Passenger Elevator" cho mã ElectricBicycle... còn firmware
 *      lại trả mã FreightInPassengerElevator. Vào bảng cả hai.
 *    TrafficParameters: firmware số nhiều, tài liệu số ít -> vào bảng cả hai.
 */
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

/** Tên hiển thị: ưu tiên tên box gửi (nếu firmware nào có), rồi bảng tiếng Việt,
 *  cuối cùng là chính mã — không bao giờ trả rỗng. */
export const algoName = (m, fromBox) => fromBox || ALGO_VI[m] || m;

/** Nhom (category) cho tung algo_model — LAY THEO web UI cua box (tab "Category"),
 *  khong phai tu gom: box tra `/algo/list` la mang chuoi ma ky thuat, KHONG co field
 *  category nao, va `_apidoc.txt` cung khong co (grep scenario|algo_type|category|group).
 *  Nen bang nay phai nhung o client, giong ALGO_VI. Thu tu nhom = thu tu box hien thi.
 *  Moi ma thuoc DUNG mot nhom. Them ma moi vao ALGO_VI ma quen o day thi no roi vao
 *  'Khác' — khong bao gio bi mat khoi luoi.
 *
 *  4 ma cuoi moi nhom la ma firmware NAY khong nap (94/98 trong ALGO_VI): giu lai cho
 *  firmware khac -> khong hien tren box hien tai, khong phai loi.
 */
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

/** Gom danh sach algo_model thanh [{cat, models}] theo thu tu ALGO_CAT — CA thu tu
 *  nhom LAN thu tu trong nhom, dung nhu web UI box liet ke.
 *
 *  Phai duyet ALGO_CAT roi loc, KHONG duoc duyet `models` roi day vao bag: `/algo/list`
 *  tra theo thu tu rieng cua box (vd LineRuleData truoc AreaRuleData), lam thu tu trong
 *  nhom lech han danh sach chinh thuc.
 *
 *  Nhom rong bi bo; ma la roi vao 'Khác' de khong bao gio mat thuat toan nao. */
export function algoGroups(models) {
  const has = new Set(models);
  const out = Object.entries(ALGO_CAT)
    .map(([cat, ms]) => ({cat, models: ms.filter(m => has.has(m))}))
    .filter(g => g.models.length);
  const rest = models.filter(m => !CAT_OF[m]);
  if (rest.length) out.push({cat: 'Khác', models: rest});
  return out;
}

const GRID = 10000;                   // hệ toạ độ của box, không phải pixel

/** Vẽ theo BƯỚC. Bấm trái thêm điểm, bấm phải KẾT THÚC bước hiện tại.
 *
 *  graph_type mà box khai báo ở /smart/default/param (đã probe cả 94 mã):
 *    polygon x86 · blend x7 · line x1 — và đúng 7 mã blend là các mã hai bước
 *    mà tài liệu nêu ở quy tắc 5 và 6, nên bảng dưới suy từ dữ liệu thật.
 *
 *  Hai mã blend tài liệu KHÔNG nêu tên (PedestrianAntiDirectionDetection,
 *  ReverseMotionOnEscalator) để mặc định area+line như nhóm quy tắc 6. Chúng là
 *  "đi ngược chiều" nên có thể thật ra là line+direction — chưa có bằng chứng,
 *  đổi khi box báo lỗi hoặc tài liệu firmware nói rõ.
 *
 *  Quy tắc 4 (lane: vùng làn + hướng + virtual loop) chưa làm: không mã nào
 *  trong 94 mã của firmware này khai báo bước lane.
 */
// `key` = tên field trong graphs mà box dùng. Đã probe /smart/default/param:
// bước hai LUÔN là `direction_line` ở cả hai nhóm blend, không phải `line`.
//   LineDetectorCrossed/LineRuleData -> {line, direction_line}
//   Climbing/Overspeed/…             -> {polygon, direction_line}
const AREA = {kind: 'polygon', key: 'polygon', min: 3, max: 6, label: 'vùng phát hiện'};
const MASK = {kind: 'polygon', key: 'polygon', min: 3, max: 6, label: 'vùng che'};
const LINE = {kind: 'line', key: 'line', min: 2, max: 2, label: 'đường thẳng'};
const DIR  = {kind: 'line', key: 'direction_line', min: 2, max: 2, label: 'đường chỉ hướng'};

// Quy tắc 5: vẽ đường thẳng XONG rồi vẽ tiếp đường chỉ hướng
const STEP_LINE_DIR = [LINE, DIR];
// Quy tắc 6: vẽ vùng XONG rồi vẽ tiếp đường thẳng. Tài liệu gọi bước 2 là
// "straight line" nhưng field box dùng là `direction_line` (đã probe) -> dùng DIR.
const STEP_AREA_LINE = [AREA, DIR];

const STEPS = {
  LineDetectorCrossed: STEP_LINE_DIR,          // Cross Line Detection
  LineRuleData: STEP_LINE_DIR,                 // Tripwire People Counting
  ClimbingDetectionAlarm: STEP_AREA_LINE,      // Climbing Detection
  VehicleOverspeedDetection: STEP_AREA_LINE,   // Campus Vehicle Overspeed
  ForkliftOverspeedDetection: STEP_AREA_LINE,  // Forklift Overspeed
  PedestrianAntiDirectionDetection: STEP_AREA_LINE,
  ReverseMotionOnEscalator: STEP_AREA_LINE,
  LongQueueDetection: [LINE],                  // box khai graph_type=line
};

/** Các bước của 1 thuật toán. usage 'NotROI' = vẽ vùng che -> luôn 1 bước polygon. */
const stepsOf = (m, usage) =>
  usage === 'NotROI' ? [MASK] : (STEPS[m] || [AREA]);

// Bước đang vẽ (P.done.length = số bước đã chốt)
const curStep = () => stepsOf(P.sel, P.usage)[P.done.length] || null;

/** Chốt bước đang vẽ, sang bước sau. Gọi khi bấm phải (hoặc line đủ 2 điểm). */
function endStep() {
  const s = curStep();
  if (!s) return;
  if (P.pts.length < s.min) return note(`${s.label}: cần ${s.min} điểm`, 'warn');
  P.done.push({key: s.key, pts: P.pts.slice()});
  P.pts = [];
  const nx = curStep();
  if (nx) note(`Xong ${s.label} → vẽ tiếp ${nx.label}`, 'ok');
  draw(); hint(); paint();
}
const shapeOf = m => (STEPS[m] || [AREA])[0].kind === 'line' ? 'line'
  : STEPS[m] ? 'blend' : 'polygon';

// state của panel đang mở
// done = các bước ĐÃ chốt [{key, pts}]; pts = bước đang vẽ
// done = các bước ĐÃ chốt [{key, pts}]; pts = bước đang vẽ
// hover = vị trí con trỏ (vẽ đường cao su); drag = {list, i} mốc đang kéo
// mode 'idle' = chi xem/chon vung cu; 'draw' = dang ve (bam "Ve vung" moi vao)
// pick = index vung da luu dang duoc chon (hien nut xoa ngay tren anh)
const P = {ch: null, name: null, algos: [], loaded: [], smart: [], sel: null,
          pts: [], done: [], hover: null, drag: null, mode: 'idle', pick: null,
          usage: 'ROI', tab: 'rule', sched: null, link: null, web: {}, defs: null};

/* ---------------- toạ độ: CSV string <-> mảng điểm ---------------- */

export function parsePts(g) {
  if (!g) return [];
  const xs = String(g.point_x || '').split(',').filter(s => s !== '');
  const ys = String(g.point_y || '').split(',').filter(s => s !== '');
  return xs.map((x, i) => [+x, +ys[i]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

export const dumpPts = pts => ({
  point_x: pts.map(p => Math.round(p[0])).join(','),
  point_y: pts.map(p => Math.round(p[1])).join(','),
});

// graphs của 1 task: {graph_type, graph_usage, polygon:{point_x,point_y}, line:{...}}
/** done = [{key,pts}] các bước đã chốt -> 1 graph. graph_type suy từ SỐ bước:
 *  1 bước polygon -> polygon, 1 bước line -> line, 2 bước -> blend (như box trả). */
function graphsFrom(model, done, usage) {
  const g = {graph_usage: usage};
  done.forEach(d => g[d.key] = dumpPts(d.pts));
  g.graph_type = done.length > 1 ? 'blend'
    : done[0]?.key === 'line' ? 'line' : 'polygon';
  return [g];
}

/** Đọc ngược graphs của box thành các bước, theo đúng thứ tự STEPS của thuật toán. */
const stepsOfTask = (t, model, usage) => {
  const g = (t?.graphs || [])[0];
  if (!g) return [];
  return stepsOf(model, usage)
    .map(s => ({key: s.key, pts: parsePts(g[s.key])}))
    .filter(d => d.pts.length);
};

// Tương thích chỗ cũ chỉ cần "có vùng hay chưa"
const ptsOfTask = t => {
  const g = (t?.graphs || [])[0];
  return parsePts(g?.polygon || g?.line);
};

/* ---------------- vẽ canvas ---------------- */

function draw() {
  const c = $('#aiCv');
  if (!c) return;
  const g = c.getContext('2d');
  const {width: w, height: h} = c;
  g.clearRect(0, 0, w, h);
  const px = p => [p[0] / GRID * w, p[1] / GRID * h];

  /** Mot hinh. Moc va duong noi DUNG MOT MAU (col) de nhin ra cung mot vung. */
  const shape = (pts, closed, col, alpha, arrow) => {
    if (!pts.length) return;
    g.globalAlpha = alpha;
    g.lineWidth = 2;
    g.strokeStyle = col;
    g.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = px(p);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    if (closed && pts.length > 2) {
      g.closePath();
      g.fillStyle = col + '24';                  // cung mau, do trong ~14%
      g.fill();
    }
    g.stroke();

    // Mui ten giua duong chi huong: khong co thi hai dau trong nhu nhau
    if (arrow && pts.length >= 2) {
      const [x1, y1] = px(pts[0]), [x2, y2] = px(pts[pts.length - 1]);
      const a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      g.beginPath();
      g.moveTo(mx + 9 * Math.cos(a), my + 9 * Math.sin(a));
      g.lineTo(mx + 9 * Math.cos(a + 2.5), my + 9 * Math.sin(a + 2.5));
      g.lineTo(mx + 9 * Math.cos(a - 2.5), my + 9 * Math.sin(a - 2.5));
      g.closePath();
      g.fillStyle = col;
      g.fill();
    }

    pts.forEach((p, i) => {
      const [x, y] = px(p);
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fillStyle = col;                          // moc cung mau duong noi
      g.fill();
      g.fillStyle = '#0a0c0f';
      g.font = '700 9px JetBrains Mono, monospace';
      g.fillText(i + 1, x - 2.5, y + 3);
    });
    g.globalAlpha = 1;
  };

  // 1. Vung DA LUU: luon hien, mau khop swatch o danh sach duoi
  const t = taskOf();
  const graphs = t?.graphs || [];
  graphs.forEach((gr, i) => {
    const col = zoneColor(i);
    const on = P.pick === i;
    stepsOf(P.sel, gr.graph_usage === 'NotROI' ? 'NotROI' : 'ROI').forEach(st => {
      shape(parsePts(gr[st.key]), st.kind === 'polygon', col,
            on ? 1 : 0.62, st.key === 'direction_line');
    });
  });

  // 2. Vung dang ve (mau tiep theo trong bang, khop dong "dang ve" o danh sach)
  const col = zoneColor(graphs.length);
  P.done.forEach(d => shape(d.pts, d.key === 'polygon', col, 0.85, d.key === 'direction_line'));
  const s = P.mode === 'draw' ? curStep() : null;
  if (!s) return;
  shape(P.pts, s.kind === 'polygon', col, 1, s.key === 'direction_line');

  // Duong cao su: moc cuoi -> con tro, NET LIEN, cung mau voi moc
  if (P.hover && P.pts.length && P.pts.length < s.max && !P.drag) {
    const [x1, y1] = px(P.pts[P.pts.length - 1]);
    const [hx, hy] = px(P.hover);
    g.save();
    g.lineWidth = 2;
    g.strokeStyle = col;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(hx, hy);
    // Polygon: he luon canh khep ve moc dau, cho thay hinh se thanh ra sao
    if (s.kind === 'polygon' && P.pts.length >= 2) {
      const [x0, y0] = px(P.pts[0]);
      g.lineTo(x0, y0);
    }
    g.stroke();
    g.restore();
  }
}

function hint() {
  // Nut "Ve vung" phai cho thay dang o mode nao, khong thi khong biet vi sao
  // bam len anh khong an.
  const btn = $('#aiDraw');
  if (btn) {
    btn.classList.toggle('on', P.mode === 'draw');
    btn.lastChild.textContent = P.mode === 'draw' ? 'Đang vẽ · bấm để dừng' : 'Vẽ vùng';
  }
  const cv = $('#aiCv');
  if (cv) cv.style.cursor = P.mode === 'draw' ? 'crosshair' : 'default';

  const el = $('#aiHint');
  if (!el) return;
  const all = stepsOf(P.sel, P.usage), s = curStep(), n = P.pts.length;
  const k = P.done.length + 1, tot = all.length;
  const pos = tot > 1 ? `Bước ${k}/${tot} · ` : '';
  el.textContent = !P.sel ? 'Chọn thuật toán trước khi vẽ vùng'
    : P.mode !== 'draw' ? 'Bấm "Vẽ vùng" để vẽ · bấm vùng trên ảnh để chọn'
    : !s ? `Đã vẽ đủ ${tot} bước — bấm Lưu cấu hình`
    : n < s.min ? `${pos}${s.label}: cần ${s.min} điểm (đang có ${n}) · bấm trái để thêm`
    : n >= s.max ? `${pos}${s.label}: đủ ${s.max} điểm — bấm PHẢI để kết thúc`
    : `${pos}${s.label}: ${n}/${s.max} điểm · bấm phải để kết thúc`;
  el.style.color = P.sel && s && n && n < s.min ? 'var(--warn)' : 'var(--faint)';
}

/* ---------------- mở panel ---------------- */

export async function openAI(name) {
  const ch = chIdOf(name);
  if (ch == null) return note(`"${name}" không phải channel của AIBOX (tên phải là ch<id>)`, 'warn');
  P.ch = ch; P.name = name; P.sel = null; P.pts = []; P.done = [];
  P.mode = 'idle'; P.pick = null; P.hover = null; P.drag = null; P.usage = 'ROI';
  P.tab = 'rule'; P.sched = null; P.link = null; P.web = {};
  goFn('ai');
  $('#aiTitle').textContent = name;
  $('#aiStream').textContent = 'channel ' + ch + ' · ' + name;
  $$('#aiTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === 'rule'));
  $('#aiFns').replaceChildren();
  $('#aiZones').replaceChildren();
  $('#aiPane').innerHTML = '<div class="zone-none">Đang đọc cấu hình từ box…</div>';
  $('#aiCv').getContext('2d').clearRect(0, 0, 9999, 9999);
  // Stream song lam nen ve vung, KHONG dung api/frame.jpeg: frame.jpeg goi ffmpeg,
  // thieu ffmpeg thi go2rtc tra 500 va nen den tron.
  // visibilityThreshold: khi doi view, section bi [hidden] -> display:none -> phan tu
  // het giao nhau -> player tu ngat. Khong can teardown tay (giong tile o luoi Live).
  const shot = $('#aiShot');
  shot.replaceChildren();                       // bo player cua camera truoc
  const vp = document.createElement('video-stream');
  vp.mode = 'webrtc,mse';                       // phai set TRUOC src
  vp.media = 'video';                           // ve vung khong can tieng
  vp.visibilityThreshold = 0.01;
  shot.append(vp);
  // setter chi doi http->ws, khong resolve duong dan -> phai la URL tuyet doi
  vp.src = new URL(`${GO}api/ws?src=${encodeURIComponent(name)}`, location.href);

  try {
    // /algo/list là cách DUY NHẤT biết box hỗ trợ thuật toán nào -> không hardcode
    const [algo, cur, smart, defs] = await Promise.all([
      post('algo/list'),
      // /algo/list = 94 cai box HO TRO; /algo/list/current = 14 cai box DA NAP.
      // Chi bat duoc cai da nap, nen picker phai dung danh sach nay.
      post('algo/list/current').catch(() => ({})),
      post('smart/list', {channel_id: ch}).catch(() => ({})),
      // Tham so MAC DINH cua ca 94 thuat toan (286 KB). Moi thuat toan mot bo
      // field rieng — bat thuat toan moi phai clone tu day, khong thi panel trong.
      post('smart/default/param').catch(() => ({})),
    ]);
    P.loaded = cur.algo_model || [];
    P.defs = defs.smart_list || [];
    // Firmware that tra data.algo_model = mang CHUOI (94 muc tren ECS-516S-SF-HD),
    // kem data.wutong_model rong. Khong phai 'list'/'algo_list' nhu doan ban dau.
    P.algos = algoList(algo);
    P.smart = smart.smart_list || [];
    P.sel = P.smart[0]?.algo_model || null;   // mo panel = chon luon cai dau, khong bat bam
    paint();
  } catch (e) {
    $('#aiPane').innerHTML = `<div class="ai-load" style="color:var(--err2)">${e.message}</div>`;
  }
}

/* ---------------- render: 1:1 theo design ---------------- */

const DAYS = [['monday', 'T2'], ['tuesday', 'T3'], ['wednesday', 'T4'], ['thursday', 'T5'],
              ['friday', 'T6'], ['saturday', 'T7'], ['sunday', 'CN']];
// object_type — lay tu bundle web UI cua box, KHONG doan:
//   value:1 typePerson, value:2 MotorVehicle, value:3 NonMotorVehicle
// 2 va 3 NGUOC voi truc giac (3 khong phai "xe 3 banh"), dung sua theo cam tinh.
const OBJ_TYPES = [[1, 'Người đi bộ'], [2, 'Xe động cơ'], [3, 'Xe không động cơ']];
const ZONE_COLORS = ['#5fe3d0', '#e5bc63', '#b57cff', '#ff5b45', '#3ddc84', '#7aa2f7'];
const zoneColor = i => ZONE_COLORS[i % ZONE_COLORS.length];

const taskOf = m => P.smart.find(t => t.algo_model === (m ?? P.sel)) || null;

function paint() {
  paintFns();
  paintZones();
  paintPane();
  hint();
}

/* --- tab tung thuat toan dang bat tren camera nay --- */
function paintFns() {
  const wrap = $('#aiFns');
  wrap.replaceChildren();
  for (const t of P.smart) {
    const m = t.algo_model;
    const el = document.createElement('button');
    el.className = 'fn-tab' + (P.sel === m ? ' on' : '');
    el.innerHTML = '<span class="d"></span><span class="l"></span><span class="x">&#10005;</span>';
    el.querySelector('.l').textContent = algoName(m);
    el.title = m;
    el.onclick = ev => {
      if (ev.target.classList.contains('x')) { ev.stopPropagation(); return removeAlgo(m); }
      P.sel = m;
      P.pts = []; P.done = []; P.mode = 'idle'; P.pick = null;   // doi thuat toan -> bo vung dang ve
      P.sched = null; P.link = null;                // lich/lien ket theo (camera, algo)
      paint(); draw();
    };
    wrap.append(el);
  }
  if (!P.smart.length) {
    const n = document.createElement('span');
    n.className = 'fn-none';
    n.textContent = 'Camera này chưa bật thuật toán nào';
    wrap.append(n);
  }
  const add = document.createElement('div');
  add.className = 'fn-add';
  add.innerHTML = '<span class="p">+</span><span class="t">Thêm chức năng AI</span>';
  add.onclick = ev => { ev.stopPropagation(); openPicker(); };
  wrap.append(add);
}

/* --- danh sach vung da ve cua thuat toan dang chon --- */
function paintZones() {
  const wrap = $('#aiZones');
  const t = taskOf();
  const graphs = (t?.graphs || []);
  if (!P.sel) {
    wrap.innerHTML = '<div class="zone-none">Chọn một thuật toán ở trên để xem vùng phát hiện</div>';
    return;
  }
  if (!graphs.length && !(P.mode === 'draw' && (P.pts.length || P.done.length))) {
    wrap.innerHTML = '<div class="zone-none">Chưa có vùng nào · bấm "Vẽ vùng" rồi bấm lên ảnh</div>';
    return;
  }
  const rows = graphs.map((g, i) => {
    const pts = parsePts(g.polygon || g.line);
    const el = document.createElement('div');
    el.className = 'zone';
    el.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="mt"></span>' +
      '<div class="grow"></div><button class="act">Sửa</button><button class="act rm">Xóa</button>';
    el.querySelector('.sw').style.background = zoneColor(i);
    el.querySelector('.nm').textContent = 'Vùng ' + (i + 1);
    el.querySelector('.mt').textContent = pts.length + ' điểm · ' +
      (g.graph_usage === 'NotROI' ? 'vùng che' : 'vùng phân tích');
    if (P.pick === i) el.classList.add('on');
    // Bam vao dong = chon vung do (to dam tren anh). Bam lan hai = bo chon.
    el.onclick = ev => {
      if (ev.target.closest('.act')) return;       // nut Sua/Xoa co handler rieng
      P.pick = P.pick === i ? null : i;
      paintZones(); draw();
    };
    const [edit, rm] = el.querySelectorAll('.act');
    edit.onclick = () => {                         // nap vung nay vao canvas de sua
      P.mode = 'draw'; P.pick = null;
      P.usage = g.graph_usage === 'NotROI' ? 'NotROI' : 'ROI';
      // Nap ca cac buoc da luu (blend co 2 buoc): chi nap 1 mang diem thi buoc
      // thu hai bien mat va Luu se bao thieu buoc.
      const st = stepsOf(P.sel, P.usage).map(x => ({key: x.key, pts: parsePts(g[x.key])}))
        .filter(x => x.pts.length);
      P.done = st.slice(0, -1);                    // cac buoc truoc: da chot
      P.pts = st.length ? st[st.length - 1].pts : [];   // buoc cuoi: cho sua tiep
      t.graphs = graphs.filter((_, k) => k !== i);
      paint(); draw();
    };
    rm.onclick = () => {
      t.graphs = graphs.filter((_, k) => k !== i);
      P.pick = null;
      paint(); draw();
    };
    return el;
  });
  // CHI khi dang o mode ve: ngoai mode ve thi P.pts da rong, nhung dieu kien chi
  // xet length nen dong nay con sot lai sau khi thoat.
  if (P.mode === 'draw' && (P.pts.length || P.done.length)) {
    const el = document.createElement('div');
    el.className = 'zone';
    el.innerHTML = '<span class="sw"></span><span class="nm"></span><span class="mt"></span>' +
      '<div class="grow"></div><button class="act rm">Bỏ</button>';
    el.querySelector('.sw').style.background = zoneColor(graphs.length);
    el.querySelector('.nm').textContent = 'Vùng ' + (graphs.length + 1);
    el.querySelector('.mt').textContent = P.pts.length + ' điểm · đang vẽ';
    el.querySelector('.act').onclick = () => { P.pts = []; P.done = []; paint(); draw(); };
    rows.push(el);
  }
  wrap.replaceChildren(...rows);
}

/* --- 3 tab con: Quy tac / Lich canh phong / Lien ket --- */
function paintPane() {
  const pane = $('#aiPane');
  if (!P.sel) {
    pane.innerHTML = '<div class="zone-none">Chọn một thuật toán để cấu hình</div>';
    return;
  }
  pane.replaceChildren(
    P.tab === 'sched' ? paneSched() : P.tab === 'link' ? paneLink() : paneRule());
}

/** O so co nut -/+ (design dung -/+ chu khong phai thanh truot). */
function spin(val, lo, hi, step, onChange) {
  const el = document.createElement('div');
  el.className = 'spin';
  el.innerHTML = '<button class="dec">−</button><input class="v" inputmode="numeric">' +
                 '<button class="inc">+</button>';
  const inp = el.querySelector('.v');
  inp.value = val;
  const set = v => {
    const n = Math.max(lo, Math.min(hi, Math.round(v)));
    inp.value = n;
    onChange(n);
  };
  el.querySelector('.dec').onclick = () => set(+inp.value - step);
  el.querySelector('.inc').onclick = () => set(+inp.value + step);
  inp.onchange = () => set(+inp.value || lo);
  return el;
}

const cfgRow = (label, hint, ctl) => {
  const el = document.createElement('div');
  el.className = 'cfg-row';
  el.innerHTML = '<div class="cfg-lb"><span class="l"></span><span class="h"></span></div>';
  el.querySelector('.l').textContent = label;
  el.querySelector('.h').textContent = hint;
  el.append(ctl);
  return el;
};

/* ---------------- bang field cua thuat toan ----------------
 * Nguon: /api/v2/smart/default/param — 94 thuat toan, 35 field khac nhau, MOI
 * thuat toan mot bo field rieng (FieldDetectorObjectsInside 17 field,
 * SmokingAlarm 4, ClimbingDetectionAlarm 3). Nen panel phai sinh dong theo field
 * co that trong task, KHONG hardcode mot bo co dinh.
 * Range lay tu chinh gia tri default box tra ve, khong doan.
 */
const FIELD = {
  sensitive:        {l: 'Độ nhạy', h: '0 – 100 · càng cao càng dễ báo', lo: 0, hi: 100, st: 5},
  report_rate:      {l: 'Giãn cách cảnh báo', h: 'giây · 0 = báo mọi lần', lo: 0, hi: 21600, st: 5},
  time_threshold:   {l: 'Ngưỡng thời gian', h: 'giây · vật ở trong vùng bao lâu mới báo',
                     lo: 0, hi: 300, st: 1},
  person_num_limit: {l: 'Giới hạn số người', h: 'vượt số này thì báo', lo: 0, hi: 200, st: 1},
  back_time_threshold: {l: 'Ngưỡng quay lại', h: 'giây', lo: 0, hi: 3600, st: 10},
  standard_line:    {l: 'Vạch chuẩn', h: '0 – 100 · vị trí vạch so sánh', lo: 0, hi: 100, st: 5},
  leashlength:      {l: 'Độ dài dây dắt', h: 'mét', lo: 0, hi: 10, st: 1},
  line_dpc_time:    {l: 'Thời gian chờ qua vạch', h: 'giây', lo: 0, hi: 300, st: 1},
  // Cong tac 0/1
  line_dpc_enable:  {l: 'Lọc qua vạch trùng lặp', sw: 1},
  fall_mode:        {l: 'Chế độ té ngã', h: '0 = thường · 1 = nghiêm ngặt', sw: 1},
  feature_mode:     {l: 'Chế độ đặc trưng', h: '0 = nhanh · 1 = chính xác', sw: 1},
  algo_model_mode:  {l: 'Chế độ thuật toán', h: '0 = thường · 1 = nâng cao', sw: 1},
  enable_work_clothes_alarm: {l: 'Báo sai trang phục', sw: 1},
  cap_large_dog:    {l: 'Bắt cả chó lớn', sw: 1},
};

// Nhom kich thuoc doi tuong: box co 3 bo person/vehicle/nonvehicle x max/min x W/H
const SZ_GROUPS = [['person', 'Người'], ['vehicle', 'Xe động cơ'],
                   ['nonvehicle', 'Xe không động cơ']];

/** Field box tra ve nhung panel chua dung duoc (mang/object phuc tap). Hien de
 *  nguoi dung biet co, va CANH BAO la phai sua tren web box. */
const RAW_FIELD = {
  lanes: 'Làn đường', workclothes_lib_list: 'Thư viện trang phục',
  speed_info: 'Ngưỡng tốc độ', congestion_info: 'Ngưỡng tắc nghẽn',
  preview_img: 'Ảnh mẫu', without_leash_time: 'Thời gian không dây dắt',
  ship_type: 'Loại tàu', autotime_info: 'Lịch tự động',
};

function paneRule() {
  const t = taskOf();
  const box = document.createElement('div');
  if (!t) {
    box.innerHTML = '<div class="zone-none">Chọn một thuật toán để cấu hình</div>';
    return box;
  }

  // 1) Cac field so / cong tac co THAT trong task nay
  const nums = Object.keys(FIELD).filter(k => t[k] != null);
  if (nums.length) {
    box.append(head('Ngưỡng phát hiện'));
    const rows = document.createElement('div');
    rows.className = 'cfg-rows';
    for (const k of nums) {
      const f = FIELD[k];
      rows.append(f.sw
        ? swRow(f.l, f.h || '', !!t[k], on => { t[k] = on ? 1 : 0; })
        : cfgRow(f.l, f.h, spin(t[k], f.lo, f.hi, f.st, v => { t[k] = v; })));
    }
    box.append(rows);
  }

  // 2) Kich thuoc doi tuong — chi hien bo nao thuat toan nay co
  const szKeys = SZ_GROUPS.filter(([p]) =>
    t[`max_${p}_object_width`] != null || t[`min_${p}_object_height`] != null);
  if (szKeys.length) {
    box.append(sep(), head('Kích thước đối tượng (0~10000)'));
    const sz = document.createElement('div');
    sz.className = 'cfg-sz';
    for (const [pre, glabel] of szKeys) {
      for (const [lb, mm] of [['Tối đa', 'max'], ['Tối thiểu', 'min']]) {
        const g = document.createElement('div');
        g.className = 'cfg-sz-g';
        g.innerHTML = '<span class="l"></span><div class="cfg-sz-r"></div>';
        g.querySelector('.l').textContent =
          szKeys.length > 1 ? `${glabel} · ${lb.toLowerCase()}` : lb;
        const r = g.querySelector('.cfg-sz-r');
        for (const [ax, dim] of [['Rộng', 'width'], ['Cao', 'height']]) {
          const key = `${mm}_${pre}_object_${dim}`;
          if (t[key] == null) continue;
          const cell = document.createElement('div');
          cell.className = 'cfg-ax';
          cell.innerHTML = '<span class="a"></span>';
          cell.querySelector('.a').textContent = ax;
          cell.append(spin(t[key], 0, 10000, 50, v => { t[key] = v; }));
          r.append(cell);
        }
        if (r.children.length) sz.append(g);
      }
    }
    box.append(sz);
  }

  // 3) Loai doi tuong — chi thuat toan nao co object_type
  if (t.object_type != null) {
    box.append(sep(), head('Loại đối tượng'), objPicker(t));
  }

  // 4) Field box tra ve nhung panel chua dung duoc
  const raw = Object.keys(RAW_FIELD).filter(k => t[k] != null);
  if (raw.length) {
    box.append(sep(), head('Chỉ sửa được trên web box'));
    const note = document.createElement('div');
    note.className = 'zone-none';
    note.textContent = raw.map(k => RAW_FIELD[k]).join(' · ')
      + ' — giữ nguyên giá trị hiện tại khi lưu.';
    box.append(note);
  }

  if (!box.children.length) {
    box.innerHTML = '<div class="zone-none">Thuật toán này không có tham số nào ngoài vùng vẽ</div>';
  }
  return box;
}

const head = txt => {
  const el = document.createElement('div');
  el.className = 'cfg-h';
  el.textContent = txt;
  return el;
};

const sep = () => Object.assign(document.createElement('div'), {className: 'cfg-sep'});

function objPicker(t) {
  const sel = new Set(t?.object_type || []);
  const wrap = document.createElement('div');
  wrap.className = 'obj-wrap';
  const head = document.createElement('div');
  head.className = 'obj-head';
  const menu = document.createElement('div');
  menu.className = 'obj-menu';
  menu.hidden = true;

  const paintHead = () => {
    head.replaceChildren();
    const on = OBJ_TYPES.filter(([v]) => sel.has(v));
    if (!on.length) {
      const c = document.createElement('span');
      c.className = 'obj-chip none';
      c.textContent = 'Chưa chọn loại nào';
      head.append(c);
    } else {
      for (const [, lb] of on) {
        const c = document.createElement('span');
        c.className = 'obj-chip';
        c.textContent = lb;
        head.append(c);
      }
    }
    const cr = document.createElement('span');
    cr.className = 'obj-caret';
    cr.textContent = menu.hidden ? '▼' : '▲';
    head.append(cr);
  };

  menu.replaceChildren(...OBJ_TYPES.map(([v, lb]) => {
    const it = document.createElement('div');
    it.className = 'obj-item' + (sel.has(v) ? ' on' : '');
    it.innerHTML = '<span class="obj-box"></span><span class="l"></span>';
    it.querySelector('.l').textContent = lb;
    it.onclick = ev => {
      ev.stopPropagation();
      sel.has(v) ? sel.delete(v) : sel.add(v);
      it.classList.toggle('on', sel.has(v));
      if (t) t.object_type = [...sel].sort();
      paintHead();
    };
    return it;
  }));

  head.onclick = ev => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
    head.classList.toggle('open', !menu.hidden);
    paintHead();
  };
  paintHead();
  wrap.append(head, menu);
  return wrap;
}


/* --- tab Lich canh phong: luoi 7x24 --- */

/** "08:00" -> 8. "24:00" -> 24 (box dung 24:00 nghia la het ngay, khong phai 23:59). */
const hOf = s => {
  const [h, m] = String(s || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
};

/** {monday:[{start,end}]} -> {monday:[bool x24]} */
const schedToCells = d => Object.fromEntries(DAYS.map(([k]) => [k,
  Array.from({length: 24}, (_, h) =>
    (d?.[k] || []).some(r => hOf(r.start) <= h && hOf(r.end) >= h + 1))]));

/** [bool x24] -> [{start:"HH:00", end:"HH:00"}], gop o lien nhau thanh 1 khoang */
const cellsToRanges = cells => {
  const out = [];
  let a = null;
  cells.forEach((on, h) => {
    if (on && a === null) a = h;
    if (!on && a !== null) { out.push(rng(a, h)); a = null; }
  });
  if (a !== null) out.push(rng(a, 24));
  return out;
};
const rng = (a, b) => ({start: String(a).padStart(2, '0') + ':00',
                        end: String(b).padStart(2, '0') + ':00'});

const SC_PRESETS = [
  ['Cả ngày', () => Array(24).fill(true)],
  ['Giờ hành chính', () => Array.from({length: 24}, (_, h) => h >= 8 && h < 18)],
  ['Ban đêm', () => Array.from({length: 24}, (_, h) => h >= 18 || h < 6)],
  ['Tắt hết', () => Array(24).fill(false)],
];

function paneSched() {
  const box = document.createElement('div');
  if (!P.sched) {
    box.innerHTML = '<div class="zone-none">Đang đọc lịch từ box…</div>';
    loadSched();
    return box;
  }
  const cells = P.sched;

  const tools = document.createElement('div');
  tools.className = 'sc-tools';
  const lb = document.createElement('span');
  lb.className = 'cfg-h';
  lb.style.margin = '0';
  lb.textContent = 'Mẫu sẵn';
  tools.append(lb);
  for (const [name, fn] of SC_PRESETS) {
    const b = document.createElement('button');
    b.className = 'sc-preset';
    b.textContent = name;
    b.onclick = () => {
      for (const [k] of DAYS) cells[k] = fn();
      paintPane();
    };
    tools.append(b);
  }
  box.append(tools);

  const grid = document.createElement('div');
  grid.className = 'sc-grid';

  const axis = document.createElement('div');
  axis.className = 'sc-axis';
  axis.innerHTML = '<span></span><div class="hh"></div>';
  axis.querySelector('.hh').replaceChildren(...['0', '6', '12', '18', '24'].map(t =>
    Object.assign(document.createElement('span'), {textContent: t})));
  grid.append(axis);

  for (const [key, label] of DAYS) {
    const row = document.createElement('div');
    row.className = 'sc-row';
    row.innerHTML = '<button class="sc-day"></button><div class="sc-cells"></div>';
    const day = row.querySelector('.sc-day');
    day.textContent = label;
    day.title = 'Bấm để bật/tắt cả ngày';
    day.onclick = () => {
      const all = cells[key].every(Boolean);
      cells[key] = Array(24).fill(!all);
      paintPane();
    };
    const cs = row.querySelector('.sc-cells');
    cells[key].forEach((on, h) => {
      const c = document.createElement('span');
      c.className = 'sc-cell' + (on ? ' on' : '');
      c.title = `${label} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`;
      c.onclick = () => { cells[key][h] = !cells[key][h]; c.classList.toggle('on', cells[key][h]); };
      cs.append(c);
    });
    grid.append(row);
  }
  box.append(grid);

  const sum = document.createElement('div');
  sum.className = 'sc-sum';
  sum.textContent = 'Bấm ô để bật/tắt từng giờ · bấm tên thứ để chọn cả ngày. '
    + 'Lịch áp riêng cho từng thuật toán.';
  box.append(sum);
  return box;
}

async function loadSched() {
  try {
    // Lich thuoc cap (camera, thuat toan) — thieu algo_model la box tra Invalid Arguments
    const d = await post('control/time/get', {channel_id: P.ch, algo_model: P.sel});
    P.sched = schedToCells(d);
  } catch (e) {
    P.sched = schedToCells(null);
    note('Không đọc được lịch: ' + e.message, 'warn');
  }
  if (P.tab === 'sched') paintPane();
}

/* --- tab Lien ket hanh dong --- */

function paneLink() {
  const box = document.createElement('div');
  if (!P.link) {
    box.innerHTML = '<div class="zone-none">Đang đọc liên kết từ box…</div>';
    loadLink();
    return box;
  }
  const L = P.link;

  const h1 = document.createElement('div');
  h1.className = 'cfg-h';
  h1.textContent = 'Cổng báo động của box';
  const outs = document.createElement('div');
  outs.className = 'cfg-rows';
  // Field cua box viet HOA chu dau: {ID, Enable} — khong nhat quan voi sound_linkage
  outs.replaceChildren(...(L.output || []).map(o => swRow(
    'Cổng ra ' + o.ID, 'relay ' + o.ID, !!o.Enable, on => { o.Enable = on ? 1 : 0; })));
  box.append(h1, outs, sep());

  const h2 = document.createElement('div');
  h2.className = 'cfg-h';
  h2.textContent = 'Loa cảnh báo';
  const snd = L.sound_linkage || (L.sound_linkage = {});
  const sb = document.createElement('div');
  sb.className = 'cfg-rows';
  sb.append(
    swRow('Phát loa trên box', 'loa gắn ở AI box', !!snd.enable,
      on => { snd.enable = on ? 1 : 0; }),
    swRow('Phát loa trên camera', 'loa gắn ở camera', !!snd.ipc_enable,
      on => { snd.ipc_enable = on ? 1 : 0; }),
    cfgRow('Âm lượng', '0 – 10',
      spin(snd.volume ?? 8, 0, 10, 1, v => { snd.volume = v; })),
    cfgRow('Số lần phát lại', 'mỗi lần cảnh báo',
      spin(snd.warn_cnt ?? 1, 1, 10, 1, v => { snd.warn_cnt = v; })));
  box.append(h2, sb, sep());

  const h3 = document.createElement('div');
  h3.className = 'cfg-h';
  h3.textContent = 'Thông báo trên máy này';
  const web = document.createElement('div');
  web.className = 'cfg-rows';
  // /linkage/web/* la cau hinh RIENG, theo camera (khong theo thuat toan)
  web.append(
    swRow('Hiện popup cảnh báo', 'góc dưới trái màn hình', P.web.popup_enable !== 0,
      on => { P.web.popup_enable = on ? 1 : 0; }),
    swRow('Đọc tiếng cảnh báo', 'giọng nói trên trình duyệt', P.web.voice_enable === 1,
      on => { P.web.voice_enable = on ? 1 : 0; }));
  box.append(h3, web);
  return box;
}

function swRow(label, meta, on, onChange) {
  const el = document.createElement('div');
  el.className = 'sw-row' + (on ? ' on' : '');
  el.innerHTML = '<div class="tx"><span class="l"></span><span class="m"></span></div>' +
                 '<div class="sw-tr"><span class="sw-kn"></span></div>';
  el.querySelector('.l').textContent = label;
  el.querySelector('.m').textContent = meta;
  el.onclick = () => {
    const now = !el.classList.contains('on');
    el.classList.toggle('on', now);
    onChange(now);
  };
  return el;
}

async function loadLink() {
  try {
    const d = await post('linkage/get', {channel_id: P.ch, algo_model: P.sel});
    P.link = d.linkage || {};
  } catch (e) {
    P.link = {};
    note('Không đọc được liên kết: ' + e.message, 'warn');
  }
  try {
    const w = await post('linkage/web/get');
    P.web = (w.linkage_web_cfg || []).find(x => x.channel_id === P.ch) || {};
  } catch { P.web = {}; }
  if (P.tab === 'link') paintPane();
}

function toggle(model, on) {
  if (on && !P.smart.some(t => t.algo_model === model)) {
    // Clone SAU tu default cua box: moi thuat toan co bo field rieng (17 / 4 / 3
    // field). Tao {algo_model, graphs:[]} rong thi panel khong co gi de cau hinh.
    const d = (P.defs || []).find(x => x.algo_model === model);
    P.smart.push(d ? JSON.parse(JSON.stringify(d)) : {algo_model: model, graphs: []});
    P.sel = model;
    P.pts = []; P.done = [];
    P.sched = null; P.link = null;        // lich/lien ket theo tung thuat toan
  } else if (!on) {
    P.smart = P.smart.filter(t => t.algo_model !== model);
    if (P.sel === model) { P.sel = null; P.pts = []; P.done = []; }
  }
  paint(); draw(); hint();
}

/* ---------------- lưu ---------------- */


/** Xoa 1 thuat toan khoi camera: hoi xac nhan -> GHI vao box -> doc lai danh sach.
 *  Khong co endpoint delete rieng; xoa = gui lai smart_list thieu cai do. */
async function removeAlgo(model) {
  const ok = await confirmBox({
    title: 'Xóa thuật toán',
    msg: `Xóa "${algoName(model)}" khỏi ${P.name}?`,
    sub: 'Vùng phát hiện, lịch canh phòng và liên kết của thuật toán này sẽ mất.',
    yes: 'Xóa',
  });
  if (!ok) return;
  const keep = P.smart.filter(t => t.algo_model !== model);
  try {
    if (keep.length) await post('smart/task', {channel_id: P.ch, status: 1});
    await post('smart/update', {
      channel_id: P.ch,
      smart_list: keep.map(t => {
        const {person_control_info, ...rest} = t;
        return rest;
      }),
    });
    // Het thuat toan -> tat AI cho ca kenh, khong de kenh bat ma rong
    if (!keep.length) await post('smart/task', {channel_id: P.ch, status: 0});

    // Doc lai TU BOX thay vi tin state cuc bo
    const sl = await post('smart/list', {channel_id: P.ch}).catch(() => ({}));
    P.smart = sl.smart_list || keep;
    if (P.sel === model) P.sel = P.smart[0]?.algo_model || null;
    P.pts = []; P.sched = null; P.link = null;
    paint(); draw();
    await capBar();
    note(`Đã xóa "${algoName(model)}" — còn ${P.smart.length} thuật toán`, 'ok');
  } catch (e) {
    note(e.message, 'err');
  }
}

/* ---------------- popup xac nhan dung chung ---------------- */

/** Hoi truoc khi lam viec khong hoan lai duoc. Tra Promise<boolean>. */
export function confirmBox({title, msg, sub, yes}) {
  return new Promise(resolve => {
    $('#cfTitle').textContent = title || 'Xác nhận';
    $('#cfMsg').textContent = msg || '';
    $('#cfSub').textContent = sub || '';
    $('#cfYes').textContent = yes || 'Xóa';
    $('#cfWrap').hidden = false;
    const done = v => {
      $('#cfWrap').hidden = true;
      $('#cfYes').onclick = $('#cfNo').onclick = $('#cfX').onclick = null;
      $('#cfWrap').onclick = null;
      resolve(v);
    };
    $('#cfYes').onclick = () => done(true);
    $('#cfNo').onclick = $('#cfX').onclick = () => done(false);
    $('#cfWrap').onclick = e => { if (e.target === $('#cfWrap')) done(false); };
  });
}

/* ---------------- nap thuat toan cho camera ---------------- */

// Moi thuat toan an ~6% cong suat box. Box het cong suat o khoang 16 cai.
// Khong hardcode 6: hoi /smart/hashinfo/get de lay so THAT theo tung bo.
const FP = {sel: new Set(), base: 0, busy: false};

async function openPicker() {
  if (!P.loaded.length) return note('Box chưa nạp thuật toán nào — vào tab Cấu hình', 'warn');
  FP.sel = new Set(P.smart.map(t => t.algo_model));
  $('#fpCam').textContent = P.name;
  $('#fpWrap').hidden = false;
  paintPicker();
  await refreshCap();
}

/** Cong suat con lai NEU ap bo dang tick. Goi box moi lan doi tick — day la so
 *  THAT, khong phai uoc luong 6%/cai. */
async function refreshCap() {
  if (FP.busy) return;
  FP.busy = true;
  try {
    const r = await hashrate(P.ch, [...FP.sel]);
    const d = r.data || {};
    const v = d.hashrate;
    FP.cap = v;
    // status_code 52040 = box bao khong du cong suat cho bo nay
    FP.over = r.status_code === 52040 || (v != null && v <= 0);
    const el = $('#fpHr'), bar = $('#fpBar');
    el.textContent = v != null ? v + '%' : '—';
    const cls = FP.over || v < 15 ? 'err' : v < 40 ? 'warn' : '';
    el.className = 'fp-cap-v ' + cls;
    bar.className = cls;
    bar.style.width = Math.max(0, Math.min(100, v ?? 0)) + '%';
  } catch {
    $('#fpHr').textContent = '—';
  } finally {
    FP.busy = false;
    paintPicker();
  }
}

function paintPicker() {
  const n = FP.sel.size;
  $('#fpCnt').textContent = n + '/' + P.loaded.length + ' thuật toán đã chọn';
  // Het cong suat -> XAM het cai chua chon, khong cho tick them
  const lock = !!FP.over;
  $('#fpHint').textContent = lock
    ? 'Hết công suất — bỏ bớt thuật toán trước khi chọn thêm'
    : 'Bỏ tích để xóa thuật toán khỏi camera này';
  $('#fpHint').style.color = lock ? 'var(--err2)' : '';

  $('#fpGrid').replaceChildren(...P.loaded.map(m => {
    const on = FP.sel.has(m);
    const el = document.createElement('div');
    el.className = 'al-item' + (on ? ' on' : '') + (!on && lock ? ' dis' : '');
    el.innerHTML = '<span class="al-box"></span><span class="al-nm"></span>';
    el.querySelector('.al-nm').textContent = algoName(m);
    el.title = m;
    el.onclick = () => {
      if (on) FP.sel.delete(m);
      else if (lock) return;               // xam roi thi khong cho tick
      else FP.sel.add(m);
      refreshCap();                        // doi tick -> hoi lai cong suat that
    };
    return el;
  }));
}

/** Nap bo dang tick vao camera. Them VA xoa cung mot luoc, vi smart/update ghi
 *  tron smart_list — thuat toan bo tich se bi xoa khoi camera. */
async function savePicker() {
  const want = [...FP.sel];
  const cur = P.smart.map(t => t.algo_model);
  const add = want.filter(m => !cur.includes(m));
  const del = cur.filter(m => !want.includes(m));
  if (!add.length && !del.length) { $('#fpWrap').hidden = true; return; }

  if (del.length) {
    const ok = await confirmBox({
      title: 'Xóa thuật toán',
      msg: `Bỏ ${del.length} thuật toán khỏi ${P.name}: ${del.map(m => algoName(m)).join(', ')}`,
      sub: 'Vùng phát hiện, lịch canh phòng và liên kết của các thuật toán này sẽ mất.',
      yes: 'Xóa',
    });
    if (!ok) return;
  }

  const btn = $('#fpSave');
  btn.disabled = true;
  btn.textContent = 'Đang nạp…';
  try {
    // Giu task cu (kem vung ve, nguong) cho cai da co; clone default cho cai moi
    const kept = P.smart.filter(t => want.includes(t.algo_model));
    const fresh = add.map(m => {
      const d = (P.defs || []).find(x => x.algo_model === m);
      return d ? JSON.parse(JSON.stringify(d)) : {algo_model: m, graphs: []};
    });
    P.smart = [...kept, ...fresh];
    if (P.smart.length) await post('smart/task', {channel_id: P.ch, status: 1});
    await post('smart/update', {
      channel_id: P.ch,
      smart_list: P.smart.map(t => {
        const {person_control_info, ...rest} = t;
        return rest;
      }),
    });
    if (!P.smart.length) await post('smart/task', {channel_id: P.ch, status: 0});

    // Doc lai TU BOX, khong tin state cuc bo — box co the bo qua cai no khong nap duoc
    const sl = await post('smart/list', {channel_id: P.ch}).catch(() => ({}));
    P.smart = sl.smart_list || P.smart;
    if (!P.smart.some(t => t.algo_model === P.sel)) P.sel = P.smart[0]?.algo_model || null;
    P.pts = []; P.sched = null; P.link = null;
    $('#fpWrap').hidden = true;
    paint(); draw();
    await capBar();
    const msg = [add.length ? `thêm ${add.length}` : '', del.length ? `xóa ${del.length}` : '']
      .filter(Boolean).join(' · ');
    note(`Đã nạp: ${msg} — ${P.name} còn ${P.smart.length} thuật toán`, 'ok');
  } catch (e) {
    note(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Nạp thuật toán';
  }
}

/** Cong suat con lai cua box, hien tren thanh tren cua trang cau hinh AI. */
async function capBar() {
  try {
    const r = await hashrate(P.ch, P.smart.map(t => t.algo_model));
    const v = (r.data || {}).hashrate;
    const el = $('#aiHr');
    el.textContent = v != null ? 'CÔNG SUẤT CÒN ' + v + '%' : '';
    el.style.color = v == null ? '' : v < 15 ? 'var(--err2)' : v < 40 ? 'var(--warn)' : 'var(--ok)';
  } catch { /* khong co cong suat thi thoi, khong chan luong chinh */ }
}

async function save() {
  const btn = $('#aiSave');
  btn.disabled = true;
  btn.textContent = 'Đang lưu…';
  try {
    if (P.sel) {                                      // chốt vùng đang vẽ vào task
      const t = P.smart.find(x => x.algo_model === P.sel);
      if (t) {
        // Bước đang vẽ mà đã đủ điểm -> tự chốt, người dùng không phải bấm phải rồi Lưu
        const s = curStep();
        const done = [...P.done];
        if (s && P.pts.length >= s.min) done.push({key: s.key, pts: P.pts.slice()});
        else if (s && P.pts.length)
          throw new Error(`${s.label} cần ít nhất ${s.min} điểm (đang có ${P.pts.length})`);
        // Thiếu bước sau -> box nhận graph không đủ field, chặn ngay ở client
        const need = stepsOf(P.sel, P.usage);
        if (done.length && done.length < need.length)
          throw new Error(`${algoName(P.sel)} cần vẽ đủ ${need.length} bước: `
            + need.map(x => x.label).join(' → '));
        if (done.length) t.graphs = graphsFrom(P.sel, done, P.usage);
      }
    }
    // Bật AI cho channel TRƯỚC khi ghi task, không thì box trả 400382
    if (P.smart.length) await post('smart/task', {channel_id: P.ch, status: 1});

    // channel_id o TOP LEVEL, KHONG trong tung item — dat trong item thi box tra
    // "Invalid Arguments" (60006) va KHONG ghi gi. Bundle web box:
    //   delete e.person_control_info; e.channel_id = Number(...); setRule(e)
    // /smart/update ghi DE CA LIST -> phai gui FULL smart_list. Thuat toan khong
    // co trong list se bi XOA khoi camera — do cung la duong xoa duy nhat, box
    // khong co endpoint delete rieng.
    await post('smart/update', {
      channel_id: P.ch,
      smart_list: P.smart.map(t => {
        const {person_control_info, ...rest} = t;   // box tu choi field nay
        return rest;
      }),
    });

    // KHONG goi extend/update nua: no tra Invalid Arguments va la endpoint CU —
    // khong con trong bundle firmware nay. smart/update DA luu sensitive/report_rate
    // (kiem chung: doi sensitive 80 -> 45 chi bang smart/update, doc lai ra 45).
    if (!P.smart.length) await post('smart/task', {channel_id: P.ch, status: 0});
    note(`Đã lưu ${P.smart.length} thuật toán cho ${P.name}`, 'ok');
  } catch (e) {
    note(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu cấu hình';
  }
}

/* ---------------- alarm realtime (SSE) ---------------- */

const AL = [];
/** Nap lich su tu alarms.jsonl vao AL. AL bat dau RONG nen tab Nhat ky trong
 *  tron cho den khi co canh bao MOI toi — goi ham nay 1 lan luc khoi dong.
 *  Khong ghi de canh bao da co trong AL (SSE co the toi truoc khi fetch xong). */
export async function loadAlarmHistory() {
  const j = await fetch(BASE + 'api/alarms', {method: 'POST'}).then(r => r.json());
  if (j.code !== 0) throw new Error(j.msg || 'code ' + j.code);
  const have = new Set(AL.map(a => a.event_id).filter(Boolean));
  const add = (j.data || []).filter(a => !a.event_id || !have.has(a.event_id));
  AL.push(...add);                          // lich su CU hon -> xuong duoi
  AL.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  AL.length = Math.min(AL.length, 300);
  return add.length;
}

export const alarms = () => AL;

/** Seed 'số người trong vùng' từ lịch sử alarm (include_area=true) — hiện số
 *  ngay sau refresh, không đợi box gửi event đầu tiên. Lấy area_num MỚI NHẤT mỗi
 *  channel (lịch sử sắp mới trước). AreaRuleData không vào AL nên không tràn log. */
export async function seedAreaCount() {
  const j = await fetch(BASE + 'api/alarms', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({include_area: true}),
  }).then(r => r.json()).catch(() => ({}));
  if (j.code !== 0) return;
  for (const a of j.data || []) {
    if (!a._is_area || a.area_num == null) continue;
    const name = camOf(a);
    if (name) setAreaCount(name, a.area_num, Date.now() / 1000);
  }
}

/** Tên stream go2rtc ứng với 1 alarm (`ch<channel_id>`), null nếu không rõ. */
export const camOf = a => (a?.channel_id != null ? 'ch' + a.channel_id : null);

/** Alarm của 1 camera, mới nhất trước — cho thanh lịch sử ở detail. */
export const alarmsOf = name => AL.filter(a => camOf(a) === name && isDetect(a));

/** type 2 = Alarm Recovery — box báo HẾT cảnh báo. Tài liệu (mục "Alarm Recovery")
 *  và 67/67 bản ghi thật đều chỉ kèm `behaviour:{algo_model}` + has_result:0, KHÔNG
 *  có ảnh, KHÔNG capture_time, KHÔNG video_url. Nếu coi là phát hiện thì nó bật
 *  popup "PHÁT HIỆN" trắng ảnh và đếm trùng viền nháy với alarm type 1 trước đó.
 *  type 6 = keep-alive mỗi 60s, 7 = đổi trạng thái channel. Không phải phát hiện.
 *  type null/undefined = alarm rác (heartbeat box gửi body rỗng) — bỏ luôn.
 *  AreaRuleData (đếm người trong vùng) KHÔNG phải cảnh báo: không popup, không
 *  vào nhật ký, không nháy viền — chỉ là con số real-time. */
export const isDetect = a => a?.type != null
  && a.type !== 2 && a.type !== 6 && a.type !== 7
  && a?.kind !== 'sse' && a?.algo_model !== 'AreaRuleData';

/** Số người trong vùng (AreaRuleData), theo tên stream. Badge hiện SỐ CUỐI CÙNG kể cả
 *  đã cũ (box không đẩy đều, ch7 đo thật im tới 975s) — chỉ ẩn khi chưa từng có số. */
const AREACOUNT = new Map();                       // name -> {n, ts}
export const areaCount = name => AREACOUNT.get(name) || null;
export const setAreaCount = (name, n, ts) => {
  if (name && n != null) AREACOUNT.set(name, {n, ts});
  return areaCount(name);
};

// Stream có 'Đếm người trong vùng' đang BẬT -> badge LUÔN hiện, kể cả chưa nhận số nào.
// Gate bằng `algos`, KHÔNG bằng `ai_on`: cả 8 kênh đều ai_on=1 mà 6 kênh algos rỗng.
const AREAON = new Set();
export const areaOn = name => AREAON.has(name);
/** Đọc /api/cameras để biết camera nào bật AreaRuleData. KHÔNG ném lỗi: bridge tắt,
 *  hoặc xem từ máy khác, thì GIỮ set cũ — badge rơi về chế độ theo dữ liệu như trước. */
export async function loadAreaOn() {
  try {
    const j = await cameraList();      // const arrow ở cuối file, nhưng chỉ chạy sau init
    if (j?.code !== 0) return;
    AREAON.clear();
    for (const c of j.data || [])
      if ((c.algos || []).includes('AreaRuleData')) AREAON.add(c.stream);
  } catch { /* giữ nguyên */ }
}

/** URL ảnh detect. Backend lưu base64 ra file, và đổi *_image_path thành
 *  '/aibox/picture?...' -> hai dạng phải xử lý khác nhau. */
export const imgOf = a => {
  const p = (a?.images || [])[0];
  if (!p) return null;
  // Phai TUYET DOI. BASE = '' khi UI chay o :8090, nen 'alarms/x.jpg' la tuong doi
  // -> phan giai theo path hien tai, lech ngay khi trang khong o '/'.
  const rel = p.startsWith('/') ? p.slice(1) : 'alarms/' + p;
  return new URL(BASE + rel, location.href).href;
};

/** URL clip xem lai. Box KHONG day file video ve — no gui video_url dang
 *  /api/v2/smart/video?ChlId=..&StartTime=..&EndTime=.. de KEO clip theo khoang
 *  thoi gian; aibox.py doi thanh /aibox/video?... (route co digest auth).
 *  Chi 1 phan alarm co clip -> luon kiem tra null truoc khi bay nut play. */
export const videoOf = a => {
  const u = a?.video_url;
  if (!u) return null;
  return new URL(BASE + (u.startsWith('/') ? u.slice(1) : u), location.href).href;
};

// Camera đang cảnh báo -> viền nháy. "Bỏ qua" xoá khỏi đây.
const ACTIVE = new Map();                             // name -> {n, ts, algo}
export const activeAlarm = name => ACTIVE.get(name) || null;
let onCleared = null;
export const clearAlarm = name => { ACTIVE.delete(name); onCleared?.(name); };

export function startAlarms(onEvent, onClear) {
  onCleared = onClear;
  // phai la BASE: UI serve tu :1984 thi 'events' tuong doi se tro vao go2rtc -> 404
  const es = new EventSource(BASE + 'events');
  es.onmessage = m => {
    let ev;
    try { ev = JSON.parse(m.data); } catch { return; }
    if (ev.kind === 'video') {                        // video có thể tới TRƯỚC alarm
      const a = AL.find(x => x.video_uuid === ev.video_uuid);
      if (a) a.video = ev.file;
    } else if (ev.algo_model === 'AreaRuleData') {
      // Đếm người trong vùng: KHÔNG phải cảnh báo — cập nhật số real-time,
      // không vào AL (nhật ký), không tăng ACTIVE. `area_num` do aibox.py truyền.
      // ts = GIỜ CLIENT, không phải ev.ts (giờ box, chậm ~272s) — xem AREA_STALE.
      setAreaCount(camOf(ev), ev.area_num, Date.now() / 1000);
    } else if (isDetect(ev)) {
      // Chỉ phát hiện thật mới vào AL (nhật ký) + tăng ACTIVE. type 2/6/7 rơi
      // xuống dưới, không chiếm chỗ trong vòng 300 bản ghi.
      AL.unshift(ev);
      AL.length = Math.min(AL.length, 300);
      const cam = camOf(ev);
      if (cam) {
        const cur = ACTIVE.get(cam);
        ACTIVE.set(cam, {n: (cur?.n || 0) + 1, ts: ev.ts,
                         algo: algoName(ev.algo_model, ev.algo_name) || ev.label});
      }
    }
    onEvent?.(ev, AL);
  };
  // EventSource tự reconnect; báo ra ngoài để UI vẽ trạng thái kết nối box
  es.onopen = () => onEvent?.({kind: 'sse', up: true}, AL);
  es.onerror = () => onEvent?.({kind: 'sse', up: false}, AL);
  return es;
}

let noteFn = (m, s) => console.log(s, m);
export const setNote = f => noteFn = f;
const note = (m, s) => noteFn(m, s);

// go() nam o app.js, ma file nay khong import app.js (vong app -> ui -> ai).
// Tiem vao nhu setNote thay vi import. Thieu no thi openAI() chet o dong `go('ai')`
// voi "ReferenceError: go is not defined" va panel khong bao gio mo.
let goFn = v => console.error('setGo() chua duoc goi, khong doi duoc view ->', v);
export const setGo = f => goFn = f;

/** Thoat mode ve: BO vung dang ve (chua luu) va tra con tro ve binh thuong.
 *  Goi khi roi panel / doi camera / bam "Dang ve" lan hai — neu khong, vung nua
 *  voi con nam trong P.pts va lan sau vao lai se thay moc cu cua camera khac. */
export function exitDraw() {
  P.mode = 'idle'; P.pts = []; P.done = []; P.hover = null; P.drag = null; P.pick = null;
  const cv = $('#aiCv');
  if (cv) cv.style.cursor = 'default';
  // Phai ve lai: xoa state khong tu xoa hinh tren canvas va dong "dang ve" o danh sach
  if ($('#aiZones')) { paint(); draw(); hint(); }
}

/* ---------------- wiring ---------------- */

export function initAI() {
  const cv = $('#aiCv');
  // Bấm TRÁI thêm điểm. Line/direction đủ 2 điểm là tự chốt bước (không thể thêm
  // nữa nên chờ bấm phải chỉ gây bối rối); polygon phải bấm PHẢI để kết thúc.
  // Toạ độ chuột -> hệ 0~10000 cua box
  const at = ev => {
    const r = cv.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * GRID, (ev.clientY - r.top) / r.height * GRID];
  };
  // Mốc gần con trỏ nhất trong bán kính HIT. Tìm cả trong bước đã chốt để kéo được.
  const HIT = 260;                                  // ~2.6% khung, xấp xỉ 8px
  const findPt = p => {
    const near = (pts, list, i0) => {
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i][0] - p[0], dy = pts[i][1] - p[1];
        if (dx * dx + dy * dy <= HIT * HIT) return {list, i, d: dx * dx + dy * dy};
      }
      return null;
    };
    return near(P.pts, P.pts) || P.done.map(d => near(d.pts, d.pts)).find(Boolean) || null;
  };

  // KÉO THẢ mốc: mousedown trên mốc -> kéo, thả ra là xong. Bắt ở mousedown nên
  // phải chặn click sau đó, không thì kéo xong lại thêm một mốc mới ở chỗ vừa thả.
  cv.onmousedown = ev => {
    if (ev.button !== 0 || !P.sel || P.mode !== 'draw') return;
    const hit = findPt(at(ev));
    if (hit) { P.drag = hit; cv.style.cursor = 'grabbing'; }
  };
  cv.onmousemove = ev => {
    const p = at(ev);
    if (P.drag) {                                   // đang kéo mốc
      P.drag.list[P.drag.i] = p;
      draw();
      return;
    }
    if (P.mode !== 'draw') { cv.style.cursor = 'default'; return; }
    // Đường cao su: nối mốc cuối tới con trỏ theo thời gian thực
    P.hover = p;
    const s = curStep();
    cv.style.cursor = findPt(p) ? 'grab' : s ? 'crosshair' : 'default';
    if (s && P.pts.length) draw();
  };
  cv.onmouseup = () => {
    if (!P.drag) return;
    P.drag = null;
    cv.style.cursor = P.mode === 'draw' ? 'crosshair' : 'default';
    P.skipClick = true;                             // chặn click sinh ra sau khi thả
    draw(); paint();
  };
  cv.onmouseleave = () => { P.hover = null; draw(); };

  cv.onclick = ev => {
    if (P.skipClick) { P.skipClick = false; return; }   // vừa kéo mốc, không thêm mốc
    if (!P.sel) return note('Chọn thuật toán trước khi vẽ vùng', 'warn');
    const s = curStep();
    if (!s) return note('Đã vẽ đủ các bước — bấm Lưu cấu hình', 'warn');
    // Đủ mốc tối thiểu rồi thì bấm TRÁI lên một mốc đã có = kết thúc bước
    if (P.pts.length >= s.min && findPt(at(ev))) return endStep();
    if (P.pts.length >= s.max) return note(`${s.label}: tối đa ${s.max} điểm, bấm phải để kết thúc`, 'warn');
    P.pts.push(at(ev));
    if (P.pts.length === s.max && s.kind === 'line') endStep();
    else { draw(); hint(); paint(); }
  };
  // Bấm PHẢI: đủ điểm -> chốt bước và sang bước sau; chưa đủ -> bỏ điểm cuối
  cv.oncontextmenu = ev => {
    ev.preventDefault();
    const s = curStep();
    if (s && P.pts.length >= s.min) return endStep();
    P.pts.pop();
    draw(); hint(); paint();
  };
  $('#aiClear').onclick = () => {
    P.pts = []; P.done = [];
    const t = taskOf();
    if (t) t.graphs = [];                     // "Xoa TAT CA vung" = ca vung da luu
    draw(); paint();
  };
  $('#aiSave').onclick = save;
  $('#fpX').onclick = $('#fpNo').onclick = () => $('#fpWrap').hidden = true;
  $('#fpWrap').onclick = e => { if (e.target === $('#fpWrap')) $('#fpWrap').hidden = true; };
  $('#fpSave').onclick = savePicker;
  $$('#aiTabs button').forEach(b => b.onclick = () => {
    P.tab = b.dataset.t;
    $$('#aiTabs button').forEach(x => x.classList.toggle('on', x === b));
    paintPane();
  });
  // "Ve vung" chi la loi nhac — ve bang cach bam thang len anh
  // "Ve vung" = VAO mode ve. Ngoai mode nay canvas chi de xem/chon vung cu,
  // khong the vo tinh them moc khi dang xem.
  $('#aiDraw').onclick = () => {
    if (!P.sel) return note('Chọn một thuật toán ở trên trước khi vẽ vùng', 'warn');
    if (P.mode === 'draw') exitDraw();              // bam lan hai = thoat mode ve
    else { P.mode = 'draw'; P.pick = null; }
    paint(); draw(); hint();
  };
  new ResizeObserver(() => {
    const s = $('#aiShot');
    if (!s.clientWidth) return;
    cv.width = s.clientWidth; cv.height = s.clientHeight;
    draw();
  }).observe($('#aiShot'));
}

// selftest (can shim `location` vi BASE/GO doc o top-level):
//   node --input-type=module -e "globalThis.location={port:'8090',hostname:'127.0.0.1',href:'http://127.0.0.1:8090/'};await import('./ui/ai.js')"
if (typeof window === 'undefined') {
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ': ' + JSON.stringify(a)); };
  eq(parsePts({point_x: '0,10000,5000', point_y: '0,0,9999'}), [[0, 0], [10000, 0], [5000, 9999]], 'parse');
  eq(parsePts({point_x: '', point_y: ''}), [], 'parse rỗng');
  eq(parsePts(null), [], 'parse null');
  eq(dumpPts([[1.6, 2.4], [3, 4]]), {point_x: '2,3', point_y: '2,4'}, 'dump làm tròn');
  eq(parsePts(dumpPts([[12, 34], [56, 78]])), [[12, 34], [56, 78]], 'round-trip');
  eq([chIdOf('ch12'), chIdOf('cam178'), chIdOf('ch')], [12, null, null], 'chIdOf');
  // AreaRuleData (đếm người trong vùng) KHÔNG phải cảnh báo; còn lại vẫn là detect
  eq(isDetect({type: 1, algo_model: 'SmokingAlarm'}), true, 'alarm thuong van detect');
  eq(isDetect({type: 1, algo_model: 'AreaRuleData'}), false, 'dem nguoi trong vung khong phai canh bao');
  eq(isDetect({type: 6}), false, 'keepalive khong detect');
  // Alarm Recovery (type 2) — shape THAT tu ECS-516S-SF-HD: chi co algo_model, images rong.
  // Neu detect = true thi no bat popup "PHAT HIEN" trang anh (bug da sua 2026-09-11).
  const rec = {kind: 'alarm', ts: 1789092465, type: 2, label: 'reset', channel_id: 2,
               channel_name: '002', event_id: '71', algo_model: 'ClimbingDetectionAlarm',
               video_url: null, images: []};
  eq(isDetect(rec), false, 'Alarm Recovery khong phai phat hien');
  eq(imgOf(rec), null, 'Alarm Recovery khong co anh');
  eq(isDetect({...rec, type: 1, images: ['20260911_094734_724fe1_image_base64.jpg']}),
    true, 'alarm type 1 cung algo van detect');
  eq(setAreaCount('ch2', 3, 1), {n: 3, ts: 1}, 'set dem vung');
  eq(areaCount('ch2'), {n: 3, ts: 1}, 'get dem vung');
  eq(areaCount('ch7'), null, 'chua co dem -> null');
  // shape THAT tu ECS-516S-SF-HD: data.algo_model la mang CHUOI, kem wutong_model
  eq(algoList({algo_model: ['SafetyHelmetAlarm', 'FallOverAlarm'], wutong_model: []}),
    [{algo_model: 'SafetyHelmetAlarm'}, {algo_model: 'FallOverAlarm'}], 'algo_model mang chuoi');
  eq(algoList({algo_model: ['A'], wutong_model: ['B']}).map(a => a.algo_model), ['A', 'B'], 'gop wutong');
  eq(algoList({algo_model: ['A', 'A']}).length, 1, 'loc trung');
  eq(algoList({list: [{algo_model: 'X', algo_name: 'Ten X'}]}), [{algo_model: 'X', algo_name: 'Ten X'}],
    'mang object van chay');
  eq(algoList({}), [], 'rong');
  // moi ma trong ALGO_VI phai co nhom; ma la khong duoc mat -> roi vao 'Khác'
  eq(Object.keys(ALGO_VI).filter(m => !CAT_OF[m]), [], 'moi algo deu co category');
  eq(algoGroups(['SmokingAlarm', 'FireDetection', 'MaLa123']).map(g => g.cat),
    ['Môi trường', 'Hành vi', 'Khác'], 'gom nhom theo thu tu box + ma la');
  eq(algoGroups([]).length, 0, 'khong co algo -> khong co nhom');
  eq(algoList(null), [], 'null');
  // buoc ve: 2 buoc cho blend, 1 buoc cho polygon thuong; key phai dung ten box dung
  eq(stepsOf('LineDetectorCrossed', 'ROI').map(s => s.key), ['line', 'direction_line'], 'buoc line+direction');
  eq(stepsOf('ClimbingDetectionAlarm', 'ROI').map(s => s.key), ['polygon', 'direction_line'], 'buoc area+line');
  eq(stepsOf('FallOverAlarm', 'ROI').map(s => [s.key, s.min, s.max]), [['polygon', 3, 6]], 'polygon 3..6');
  eq(stepsOf('LongQueueDetection', 'ROI').map(s => [s.key, s.min]), [['line', 2]], 'line 2 diem');
  eq(stepsOf('LineDetectorCrossed', 'NotROI').map(s => s.key), ['polygon'], 'vung che luon 1 buoc');
  // graph_type suy tu SO buoc, va moi buoc ghi dung field cua no
  // so tung field: JSON.stringify so ca THU TU key nen so ca object rat de vo oan
  const bl = graphsFrom('ClimbingDetectionAlarm',
      [{key: 'polygon', pts: [[0, 0], [10000, 0], [5000, 9000]]},
       {key: 'direction_line', pts: [[0, 5000], [10000, 5000]]}], 'ROI')[0];
  eq(Object.keys(bl).sort(), ['direction_line', 'graph_type', 'graph_usage', 'polygon'], 'blend co 4 field');
  eq(bl.graph_type, 'blend', 'blend graph_type');
  eq(bl.polygon, {point_x: '0,10000,5000', point_y: '0,0,9000'}, 'blend polygon');
  eq(bl.direction_line, {point_x: '0,10000', point_y: '5000,5000'}, 'blend direction_line');
  eq(graphsFrom('FallOverAlarm', [{key: 'polygon', pts: [[0, 0], [100, 0], [50, 90]]}], 'ROI')[0].graph_type,
     'polygon', 'mot buoc polygon');
  eq(graphsFrom('LongQueueDetection', [{key: 'line', pts: [[0, 0], [100, 0]]}], 'ROI')[0].graph_type,
     'line', 'mot buoc line');
  // mergeRtsp: form sua camera — pass trong = giu mat khau cu, host/path lay tu URL hien thi
  eq(mergeRtsp('rtsp://admin:old@1.2.3.4:554/ch01', 'rtsp://admin:••••@1.2.3.4:554/ch01', '', ''),
     'rtsp://admin:old@1.2.3.4:554/ch01', 'pass trong = giu mat khau cu');
  eq(mergeRtsp('rtsp://admin:old@1.2.3.4:554/ch01', 'rtsp://admin:••••@1.2.3.4:554/ch01', '', 'new'),
     'rtsp://admin:new@1.2.3.4:554/ch01', 'pass moi thay the');
  eq(mergeRtsp('rtsp://admin:old@1.2.3.4:554/ch01', 'rtsp://admin:••••@5.6.7.8:554/ch02', '', ''),
     'rtsp://admin:old@5.6.7.8:554/ch02', 'doi host giu pass cu');
  eq(mergeRtsp('rtsp://admin:old@1.2.3.4:554/ch01', 'rtsp://admin:••••@1.2.3.4:554/ch01', 'root', ''),
     'rtsp://root:old@1.2.3.4:554/ch01', 'doi username giu pass cu');
  eq(mergeRtsp('rtsp://admin:old@1.2.3.4:554/ch01', 'rtsp://1.2.3.4:554/ch01', '', ''),
     'rtsp://admin:old@1.2.3.4:554/ch01', 'bo userinfo trong URL van giu creds cu');
  console.log('ai.js selftest ok');
}

/* ---------------- tab Cấu hình: 20 thuật toán box nạp ---------------- */

/** Bridge gộp /algo/list + /algo/list/current + /smart/hashinfo/get thành 1 call. */
export const algoAll = () =>
  fetch(BASE + 'api/algo/all', {method: 'POST'}).then(r => r.json());

/** Danh sách camera + thuật toán đang bật mỗi cái (/channel/list + /smart/enable/list). */
export const cameraList = () =>
  fetch(BASE + 'api/cameras', {method: 'POST'}).then(r => r.json());

/** Công suất còn lại NẾU áp bộ algo này cho channel đó. Đây là số THẬT của box —
 *  web UI Uniview dùng đúng endpoint này để vẽ "Remaining computing power".
 *  status_code 52040 = không đủ công suất. */
/** Nap bo thuat toan cho CA BOX (toi da 20). Endpoint that la
 *  "/api/v2/algo/capabilities " — CO dau cach cuoi duong dan, bundle web box viet
 *  vay. Body chua dò ra duoc (4 shape deu tra code 1) nen bridge thu lan luot roi
 *  bao loi that; khong doan bua vao endpoint ghi cau hinh toan box. */
export const algoSave = models =>
  fetch(BASE + 'api/algo/save', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({algo_model: models}),
  }).then(r => r.json());

export const hashrate = (ch, algos) =>
  fetch(BASE + 'api/hashrate', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({channel_id: ch, algo_model: algos}),
  }).then(r => r.json());
