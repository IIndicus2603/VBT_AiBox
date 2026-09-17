"""Alarm normalization: raw box JSON -> UI/Telegram event.

Ported VERBATIM from D:/test/Unv_Smartbox/aibox.py. Owns ONLY:
  - TYPES (aibox.py:695)
  - ALGO_VI (aibox.py:701-752)
  - _algo_vi (aibox.py:755-762)
  - _save_images (aibox.py:1715-1743; images stored via MongoDB GridFS instead
    of flat files)
  - _norm_alarm (aibox.py:1746-1777)
  - _person_of (aibox.py:1780-1799)
  - _images_of (aibox.py:1802-1810)
Imports: config, mongo, base64, gridfs. Does NOT define _publish/_box_gate/
handle_alarm (those live in publish.py / receiver.py).
"""
import base64
import gridfs
import time

from app import config
from app.db import mongo

# Giong aibox.py:695-696.
TYPES = {1: 'behavior', 2: 'reset', 3: 'face', 4: 'facematch',
         5: 'behavior+match', 6: 'keepalive', 7: 'channel'}

# Ten hien thi tieng Viet cho tung algo_model (dong bo voi ALGO_VI trong ui/ai.js).
# Box chi gui ma ky thuat (LineDetectorCrossed...) -> phai dich sang ten hanh vi de
# nguoi xem Telegram hieu ngay. Ma la -> giu nguyen (khong bao gio tra rong).
ALGO_VI = {
    'SafetyHelmetAlarm': 'Không mũ bảo hộ', 'WorkClothesAlarm': 'Không đồng phục',
    'TelephoningAlarm': 'Gọi điện thoại', 'SmokingAlarm': 'Hút thuốc',
    'SleepingDetectionAlarm': 'Ngủ khi làm việc', 'OffDutyDetectionAlarm': 'Vắng mặt',
    'ChannelBlockageDetection': 'Chắn lối thoát hiểm', 'ObjectRemoved': 'Vật để lại',
    'FieldDetectorObjectsInside': 'Xâm nhập vùng', 'AccessElevatorAlarm': 'Xe điện vào thang máy',
    'NoMaskAlarm': 'Không khẩu trang', 'FallOverAlarm': 'Té ngã',
    'CrowdDensityCriticalAlarm': 'Quá đông người', 'ReflectiveClothesDetectionAlarm': 'Không áo phản quang',
    'AbnormalParkingDetection': 'Đỗ xe sai / chắn lối chữa cháy',
    'AbnormalParkingDetection_HighSpeedEvent': 'Đỗ xe bất thường (giao thông)',
    'FumesAlarmBegin': 'Khói', 'PlayMobilePhoneDetection': 'Dùng điện thoại',
    'FireDetection': 'Cháy', 'LongStayDetection': 'Ở lại quá lâu',
    'FightDetectionAlarm': 'Đánh nhau', 'LineDetectorCrossed': 'Vượt vạch',
    'EnterArea': 'Vào vùng', 'LeaveArea': 'Ra khỏi vùng',
    'AreaRuleData': 'Đếm người trong vùng', 'LineRuleData': 'Đếm người qua vạch',
    'ObjectIsRecognized': 'Nhận diện mặt', 'NonMotorAbnormalParkingDetection': 'Xe 2 bánh đỗ sai',
    'UncoveredTrashCanDetection': 'Thùng rác mở nắp', 'MouseDetect': 'Chuột',
    'BareSoilCoverDetection': 'Đất trống chưa phủ', 'DisorderStackingDetection': 'Xếp vật liệu sai',
    'TrashOverflowingDetection': 'Thùng rác tràn', 'ExposedGarbageDetection': 'Rác lộ thiên',
    'PackedGarbageDetection': 'Rác đóng túi', 'ShirtlessDetection': 'Không mặc áo',
    'ChefHatAlarm': 'Không mũ đầu bếp', 'ChefClothesDetection': 'Không đồng phục đầu bếp',
    'SafetyHarnessDetection': 'Không dây an toàn', 'ClimbingDetectionAlarm': 'Trèo leo',
    'PeopleGathering': 'Tụ tập', 'FastMoving': 'Di chuyển nhanh',
    'StayAloneDetection': 'Thiếu người trực', 'KnifeStickDetection': 'Cầm dao / gậy',
    'UnwashedVehicleDetection': 'Xe chưa rửa', 'VehicleOverspeedDetection': 'Xe quá tốc độ',
    'ForkliftOverspeedDetection': 'Xe nâng quá tốc độ', 'NoSafetyBeltDetection': 'Không thắt dây an toàn',
    'PresetMarkerDetection': 'Mốc định sẵn', 'GasCylinderDetection': 'Bình gas',
    'ChargingGunNotinPlace': 'Súng sạc không đúng chỗ', 'NoFireExtinguisherDetection': 'Thiếu bình chữa cháy',
    'DumpTruckWithoutTarp': 'Xe ben không phủ bạt', 'OilLeakDetection': 'Rò dầu',
    'GasLeakDetection': 'Rò khí', 'LiquidLeakDetection': 'Rò nước',
    'TestPaperColorChangeDetection': 'Giấy thử đổi màu', 'NoSafetyGogglesDetection': 'Không kính bảo hộ',
    'NoSafetyGlovesDetection': 'Không găng tay', 'NoDustGasMaskDetection': 'Không mặt nạ phòng độc',
    'ExposedLongHairDetection': 'Tóc dài không buộc', 'CampusEntranceExitLPC': 'Biển số ra vào khu',
    'CampusVehicleCongestionDetection': 'Ùn xe trong khu', 'DogDetection': 'Chó',
    'FuelUnloadDetect': 'Xả dầu', 'Construction': 'Thi công đường',
    'ThrowingEvent': 'Ném rác', 'TrafficAccident': 'Tai nạn giao thông',
    'DriveSlowly': 'Xe chạy quá chậm', 'DriveAway': 'Xe rời đi',
    'Fogging': 'Sương mù', 'NonMotorVehicleIntrusionDetection': 'Xe 2 bánh xâm nhập',
    'OccupancyEmergencyLane': 'Chiếm làn khẩn cấp', 'Pedestrian': 'Người đi bộ xâm nhập',
    'Retrograde': 'Xe đi ngược chiều', 'SnowCover': 'Tuyết phủ mặt đường',
    'Congestion': 'Ùn tắc', 'VehicleEnterExitServiceStation': 'Xe ra vào trạm',
    'ForkliftDetection': 'Xe nâng', 'EngineeringVehicleDetection': 'Xe công trình',
    'IllegalAdditionOfBulkGasoline': 'Bơm xăng trái phép', 'WildlifeIntrusionDetection': 'Động vật xâm nhập',
    'FireOperationUnattended': 'Hàn cắt không người trông', 'SmokeAndFireDetectionEvent': 'Khói và lửa',
    'RestrictedAreaFishingDetection': 'Đánh bắt khu cấm', 'WaterOutletDischargeDetection': 'Xả thải cửa nước',
    'HandDetection': 'Bàn tay', 'FreightInPassengerElevator': 'Chở hàng trong thang khách',
    'ElectricBicycleIntrusionDetection': 'Chở hàng trong thang khách', 'LongQueueDetection': 'Xếp hàng dài',
    'LightsLeftOnDetection': 'Quên tắt đèn', 'PedestrianAntiDirectionDetection': 'Người đi ngược chiều',
    'ReverseMotionOnEscalator': 'Đi ngược thang cuốn', 'GunmanDetection': 'Súng',
    'ShipDetection': 'Tàu thuyền', 'SurfaceWaterDetection': 'Ngập nước mặt đường',
    'TrafficParameters': 'Thông số giao thông', 'TrafficParameter': 'Thông số giao thông',
}


def _algo_vi(ev):
    """Ten hanh vi tieng Viet cua alarm. Uu tien algo_model (dich qua ALGO_VI),
    roi label (type 1=behavior), cuoi cung ma thay."""
    m = ev.get('algo_model')
    if m:
        return ALGO_VI.get(m) or m
    return ev.get('label') or str(ev.get('type') or 'Canh bao')


def _save_images(alarm, stamp):
    """Anh ve 3 cach: base64 -> luu vao MongoDB GridFS, path de GET ve tu box,
    hoac khong co. Tra (saved, person_img): saved = danh sach anh da luu;
    person_img = URL anh mat cua nguoi duoc nhan dien (compare_results[0]) neu co.
    (Ported from aibox.py:1715-1743; base64 images went to flat files there, here
    they go into GridFS. Paths stay /aibox/picture?... URLs.)"""
    saved, person_img = [], None
    groups = [(alarm.get('behaviour'), 'cam'), (alarm.get('face'), 'cam')]
    for r in (alarm.get('compare_results') or []):
        groups.append((r, 'person'))
    for obj, tag in groups:
        if not isinstance(obj, dict):
            continue
        for key in ('image_base64', 'orig_image_base64', 'crop_image_base64'):
            if obj.get(key):
                fn = f'{stamp}_{tag}_{key}.jpg'
                try:
                    gridfs.GridFS(mongo.db()).put(base64.b64decode(obj[key]),
                                                  filename=fn)
                except Exception:
                    pass
                saved.append(fn)
                if tag == 'person' and person_img is None:
                    person_img = fn
        for key in ('image_path', 'orig_image_path', 'crop_image_path'):
            if obj.get(key):
                url = '/aibox/picture?' + obj[key].split('?', 1)[-1]
                saved.append(url)
                if tag == 'person' and person_img is None:
                    person_img = url
    return saved, person_img


def _norm_alarm(alarm, images=None, person_image=None):
    """JSON tho cua box -> event cho UI. Dung cho ca alarm push VA khi doc lai
    alarms.jsonl (tab Nhat ky can lich su, khong chi cai toi trong phien nay)."""
    ci = alarm.get('channel_info') or {}
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    t = alarm.get('type')
    return {'kind': 'alarm', 'ts': obj.get('capture_time') or int(time.time()),
            'type': t, 'label': TYPES.get(t, str(t)),
            'channel_id': ci.get('channel_id', alarm.get('channel_id')),
            'channel_name': ci.get('channel_name') or alarm.get('channel_name'),
            'ipc_addr': ci.get('ipc_addr'),
            'event_id': alarm.get('event_id'),
            'algo_model': obj.get('algo_model') or alarm.get('algo_model'),
            # Danh sach doi tuong phat hien (capture_info): moi phan tu 1 doi tuong
            # (object_type, target_id, toa do...). Dung de ghi so doi tuong vao Telegram.
            'capture_info': obj.get('capture_info') or [],
            # Người được nhận diện (compare_results[0]): tên + độ chính xác + ảnh mặt.
            # Box gửi kèm ở type 4 (face match) và type 5 (behavior + face match).
            'person': _person_of(alarm, person_image),
            # Đếm người trong vùng (AreaRuleData): con số real-time, không phải alarm
            'area_num': obj.get('area_num'),
            # Box KHONG day file video — chi gui video_url dang
            # /api/v2/smart/video?ChlId=..&StartTime=..&EndTime=.. de KEO clip ve.
            # Doi sang route proxy cua bridge de browser goi duoc (co digest auth).
            'video_url': ('/aibox/video?' + obj['video_url'].split('?', 1)[-1]
                          if obj.get('video_url') else None),
            'video_uuid': obj.get('video_uuid'),
            # Platform (slot 1|2) alarm day ve — box khong gui trong payload, ma
            # ghi tu URL dang ky (?slot=N) o handle_alarm. Dung de Telegram loc
            # theo /setup all platformN. None = khong ro (dung de gui het).
            'platform': alarm.get('platform'),
            'images': images if images is not None else _images_of(alarm)}


def _person_of(alarm, person_image):
    """Ten + do chinh xac + anh mat cua nguoi duoc nhan dien. person_image la URL
    da co san (live) hoac None de tu resolve tu compare_results (doc lai jsonl)."""
    for r in (alarm.get('compare_results') or []):
        if not isinstance(r, dict):
            continue
        if r.get('person_name') or r.get('similarity') is not None:
            out = {'name': r.get('person_name'),
                   'similarity': r.get('similarity'),
                   'lib': r.get('lib_name')}
            img = person_image
            if not img:
                for key in ('image_path', 'crop_image_path'):
                    if r.get(key):
                        img = '/aibox/picture?' + r[key].split('?', 1)[-1]
                        break
            if img:
                out['image'] = img
            return out
    return None


def _images_of(alarm):
    """Ten file anh da luu cho alarm nay. Khi doc lai tu jsonl thi anh base64 da
    duoc ghi ra dia tu truoc — doi chieu bang capture_time + algo_model."""
    obj = alarm.get('behaviour') or alarm.get('face') or {}
    out = []
    for key in ('image_path', 'orig_image_path', 'crop_image_path'):
        if obj.get(key):
            out.append('/aibox/picture?' + obj[key].split('?', 1)[-1])
    return out