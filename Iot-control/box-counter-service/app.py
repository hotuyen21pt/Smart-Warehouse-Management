"""Dịch vụ đếm thùng (box) bằng YOLO.

Nhận một hoặc nhiều ảnh qua HTTP, chạy model YOLO (best.pt) và trả về số
lượng object thuộc lớp "box" phát hiện được trên từng ảnh và tổng cộng.
"""

import io
import os
import math
import logging

from fastapi import FastAPI, File, UploadFile, HTTPException
from PIL import Image, ImageOps, ImageEnhance
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("box-counter")


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")

# Cấu hình qua biến môi trường.
MODEL_PATH = os.getenv("MODEL_PATH", "/app/model/best.pt")
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.55"))
# Kích thước ảnh khi suy luận. Lớn hơn (960/1280) giúp bắt được box nhỏ/ở xa,
# đổi lại chậm hơn và tốn RAM hơn.
IMGSZ = int(os.getenv("IMGSZ", "960"))
# Ngưỡng IoU cho NMS. Cao hơn -> ít gộp/loại các box chồng nhau -> giữ được
# nhiều đối tượng đứng sát nhau hơn (thử 0.6 khi box xếp khít).
IOU_THRESHOLD = float(os.getenv("IOU_THRESHOLD", "0.7"))
# Lọc theo diện tích bounding box tính bằng % diện tích ảnh (không phụ thuộc
# độ phân giải). Box nhỏ hơn ngưỡng bị bỏ qua (vật ở xa / nhận nhầm).
# Ví dụ 0.5 = bỏ box chiếm dưới 0.5% diện tích ảnh. Đặt 0 để tắt lọc.
MIN_BOX_AREA_PCT = float(os.getenv("MIN_BOX_AREA_PCT", "0.3"))

# ── Soft-NMS: giảm đếm trùng ở cảnh box xếp khít ───────────────────────────
# Thay vì loại thẳng box chồng nhau (hard-NMS), soft-NMS GIẢM DẦN điểm tin cậy
# của box chồng theo mức độ chồng: score *= exp(-iou^2 / sigma). Box thật (chồng
# ít) vẫn giữ điểm cao; box trùng (chồng nhiều) bị hạ điểm và rơi dưới ngưỡng.
SOFT_NMS = _env_bool("SOFT_NMS", True)
# Sigma càng nhỏ càng phạt mạnh box chồng (0.5 là mức thường dùng).
SOFT_NMS_SIGMA = float(os.getenv("SOFT_NMS_SIGMA", "0.5"))
# Khi bật soft-NMS: chạy model với NMS lỏng (iou cao) + ngưỡng conf thấp để giữ
# nhiều ứng viên cho soft-NMS xử lý.
SOFT_NMS_CAND_IOU = float(os.getenv("SOFT_NMS_CAND_IOU", "0.9"))
SOFT_NMS_CAND_CONF = float(os.getenv("SOFT_NMS_CAND_CONF", "0.25"))

# ── Ngưỡng conf theo kích thước box ────────────────────────────────────────
# Box nhỏ (đặc trưng ít) dễ dương-tính-giả -> yêu cầu conf cao hơn; box lớn tin
# cậy hơn -> hạ ngưỡng. Ngưỡng áp cho box giữa hai mốc là CONF_THRESHOLD.
SIZE_AWARE_CONF = _env_bool("SIZE_AWARE_CONF", True)
SMALL_AREA_PCT = float(os.getenv("SMALL_AREA_PCT", "1.0"))   # < mốc này = box nhỏ
LARGE_AREA_PCT = float(os.getenv("LARGE_AREA_PCT", "5.0"))   # > mốc này = box lớn
CONF_SMALL = float(os.getenv("CONF_SMALL", "0.65"))
CONF_LARGE = float(os.getenv("CONF_LARGE", "0.45"))


def _iou_px(a: tuple, b: tuple) -> float:
    """IoU của 2 box dạng (x1, y1, x2, y2) theo pixel."""
    ix1 = max(a[0], b[0])
    iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2])
    iy2 = min(a[3], b[3])
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    uni = area_a + area_b - inter
    return inter / uni if uni > 0 else 0.0


def _soft_nms(dets: list[dict], sigma: float, score_floor: float) -> list[dict]:
    """Gaussian soft-NMS. dets: [{"box": (x1,y1,x2,y2), "conf": float}].

    Lần lượt chọn box điểm cao nhất, hạ điểm các box còn lại theo độ chồng với
    nó, loại box rơi dưới score_floor. Trả về các box giữ lại (điểm đã hiệu chỉnh).
    """
    pool = [dict(d) for d in dets]
    kept: list[dict] = []
    while pool:
        m = max(range(len(pool)), key=lambda i: pool[i]["conf"])
        best = pool.pop(m)
        kept.append(best)
        for d in pool:
            ov = _iou_px(best["box"], d["box"])
            d["conf"] *= math.exp(-(ov * ov) / sigma) if sigma > 0 else (0.0 if ov > 0 else 1.0)
        pool = [d for d in pool if d["conf"] >= score_floor]
    return kept


def _min_conf_for_area(area_pct: float) -> float:
    """Ngưỡng conf tối thiểu theo % diện tích box (khi bật SIZE_AWARE_CONF)."""
    if not SIZE_AWARE_CONF:
        return CONF_THRESHOLD
    if area_pct < SMALL_AREA_PCT:
        return CONF_SMALL
    if area_pct > LARGE_AREA_PCT:
        return CONF_LARGE
    return CONF_THRESHOLD

# ── Tiền xử lý ảnh đầu vào (giúp model đếm chính xác hơn) ──────────────────
# Sửa hướng ảnh theo EXIF: ảnh chụp điện thoại hay bị xoay -> không sửa thì
# model nhìn ảnh nằm ngang và đếm sai. Nên để bật.
PREPROCESS_EXIF = _env_bool("PREPROCESS_EXIF", True)
# Cân bằng tương phản tự động: hữu ích cho ảnh thiếu sáng / ngược sáng.
PREPROCESS_AUTOCONTRAST = _env_bool("PREPROCESS_AUTOCONTRAST", False)
# % pixel sáng/tối nhất bị cắt khi autocontrast (tránh nhiễu cực trị).
AUTOCONTRAST_CUTOFF = float(os.getenv("AUTOCONTRAST_CUTOFF", "1"))
# Làm nét: giúp viền thùng rõ hơn cho ảnh hơi mờ (mặc định tắt vì dễ tạo nhiễu).
PREPROCESS_SHARPEN = _env_bool("PREPROCESS_SHARPEN", False)
SHARPEN_FACTOR = float(os.getenv("SHARPEN_FACTOR", "1.5"))
# Tên lớp được tính là "thùng". Model hiện có lớp ['-', 'box'].
BOX_CLASS_NAME = os.getenv("BOX_CLASS_NAME", "box").lower()

app = FastAPI(title="Box Counter", version="1.0.0")

# Load model một lần khi khởi động (tốn vài giây).
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Không tìm thấy model tại: {MODEL_PATH}")
logger.info("Đang load model YOLO từ %s ...", MODEL_PATH)
model = YOLO(MODEL_PATH)
CLASS_NAMES = model.names
logger.info(
    "Đã load model. Các lớp: %s | conf=%.2f | imgsz=%d | iou=%.2f | min_area=%.2f%% "
    "| soft_nms=%s(sigma=%.2f) | size_aware=%s(small<%.1f%%=%.2f, large>%.1f%%=%.2f) "
    "| exif=%s autocontrast=%s sharpen=%s",
    CLASS_NAMES, CONF_THRESHOLD, IMGSZ, IOU_THRESHOLD, MIN_BOX_AREA_PCT,
    SOFT_NMS, SOFT_NMS_SIGMA,
    SIZE_AWARE_CONF, SMALL_AREA_PCT, CONF_SMALL, LARGE_AREA_PCT, CONF_LARGE,
    PREPROCESS_EXIF, PREPROCESS_AUTOCONTRAST, PREPROCESS_SHARPEN,
)


def preprocess(image: Image.Image) -> Image.Image:
    """Chuẩn hoá ảnh trước khi đưa vào model để đếm ổn định hơn."""
    # 1) Sửa hướng theo EXIF rồi mới chuyển RGB (exif_transpose phải chạy trước
    #    khi xoá metadata qua convert).
    if PREPROCESS_EXIF:
        image = ImageOps.exif_transpose(image)
    image = image.convert("RGB")
    # 2) Cân bằng tương phản tự động (ảnh thiếu sáng / ngược sáng).
    if PREPROCESS_AUTOCONTRAST:
        image = ImageOps.autocontrast(image, cutoff=AUTOCONTRAST_CUTOFF)
    # 3) Làm nét nhẹ (tùy chọn).
    if PREPROCESS_SHARPEN:
        image = ImageEnhance.Sharpness(image).enhance(SHARPEN_FACTOR)
    return image


def detect_boxes(image: Image.Image) -> list[dict]:
    """Phát hiện các object thuộc lớp box trong một ảnh PIL.

    Trả về danh sách box với toạ độ CHUẨN HOÁ 0..1 theo ảnh (đã sửa EXIF):
    [{"x1", "y1", "x2", "y2", "conf"}]. Toạ độ chuẩn hoá giúp frontend vẽ
    đúng ở mọi độ phân giải và đổi thẳng sang định dạng YOLO khi lưu dataset.
    """
    w = float(image.width)
    h = float(image.height)
    img_area = w * h
    if w <= 0 or h <= 0:
        return []

    # Khi bật soft-NMS: chạy model với NMS lỏng + conf thấp để lấy nhiều ứng viên,
    # rồi tự hạ điểm box chồng. Ngược lại dùng NMS chuẩn của YOLO như cũ.
    results = model.predict(
        source=image,
        conf=SOFT_NMS_CAND_CONF if SOFT_NMS else CONF_THRESHOLD,
        imgsz=IMGSZ,
        iou=SOFT_NMS_CAND_IOU if SOFT_NMS else IOU_THRESHOLD,
        verbose=False,
    )

    # Gom ứng viên thuộc lớp box (toạ độ pixel để tính IoU cho soft-NMS).
    cands: list[dict] = []
    for r in results:
        for box in r.boxes:
            name = CLASS_NAMES[int(box.cls)].lower()
            if name != BOX_CLASS_NAME:
                continue
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            conf = float(box.conf[0]) if box.conf is not None else 0.0
            cands.append({"box": (x1, y1, x2, y2), "conf": conf})

    # Soft-NMS: giảm điểm box chồng nhau. score_floor lấy ngưỡng thấp nhất có thể
    # (theo kích thước) để không loại nhầm trước khi lọc tinh ở dưới.
    if SOFT_NMS and cands:
        floor = min(CONF_THRESHOLD, CONF_SMALL, CONF_LARGE) if SIZE_AWARE_CONF else CONF_THRESHOLD
        cands = _soft_nms(cands, SOFT_NMS_SIGMA, floor)

    boxes: list[dict] = []
    for c in cands:
        x1, y1, x2, y2 = c["box"]
        conf = c["conf"]
        box_area = (x2 - x1) * (y2 - y1)
        area_pct = (box_area / img_area) * 100 if img_area > 0 else 0.0
        # Lọc box quá nhỏ (vật ở xa / nhận nhầm).
        if area_pct < MIN_BOX_AREA_PCT:
            continue
        # Ngưỡng conf theo kích thước (box nhỏ khắt khe hơn, box lớn dễ hơn).
        if conf < _min_conf_for_area(area_pct):
            continue
        boxes.append({
            "x1": x1 / w,
            "y1": y1 / h,
            "x2": x2 / w,
            "y2": y2 / h,
            "conf": conf,
        })
    return boxes


@app.get("/health")
def health():
    return {
        "status": "ok",
        "classes": CLASS_NAMES,
        "conf": CONF_THRESHOLD,
        "imgsz": IMGSZ,
        "iou": IOU_THRESHOLD,
        "min_box_area_pct": MIN_BOX_AREA_PCT,
        "soft_nms": {
            "enabled": SOFT_NMS,
            "sigma": SOFT_NMS_SIGMA,
            "cand_iou": SOFT_NMS_CAND_IOU,
            "cand_conf": SOFT_NMS_CAND_CONF,
        },
        "size_aware_conf": {
            "enabled": SIZE_AWARE_CONF,
            "small_area_pct": SMALL_AREA_PCT,
            "conf_small": CONF_SMALL,
            "large_area_pct": LARGE_AREA_PCT,
            "conf_large": CONF_LARGE,
        },
        "preprocess": {
            "exif": PREPROCESS_EXIF,
            "autocontrast": PREPROCESS_AUTOCONTRAST,
            "sharpen": PREPROCESS_SHARPEN,
        },
    }


@app.post("/count")
async def count(files: list[UploadFile] = File(...)):
    """Đếm box trên các ảnh tải lên.

    Trả về tổng số box và chi tiết từng ảnh.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Không có file nào được tải lên")

    per_image = []
    total = 0
    for f in files:
        data = await f.read()
        if not data:
            per_image.append({"filename": f.filename, "count": 0, "error": "file rỗng"})
            continue
        try:
            image = preprocess(Image.open(io.BytesIO(data)))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không đọc được ảnh %s: %s", f.filename, exc)
            per_image.append({"filename": f.filename, "count": 0, "error": "ảnh không hợp lệ"})
            continue

        boxes = detect_boxes(image)
        n = len(boxes)
        total += n
        per_image.append({
            "filename": f.filename,
            "count": n,
            "width": image.width,
            "height": image.height,
            "boxes": boxes,
        })

    return {"total": total, "per_image": per_image}
