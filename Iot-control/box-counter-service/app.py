"""Dịch vụ đếm thùng (box) bằng YOLO.

Nhận một hoặc nhiều ảnh qua HTTP, chạy model YOLO (best.pt) và trả về số
lượng object thuộc lớp "box" phát hiện được trên từng ảnh và tổng cộng.
"""

import io
import os
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
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.25"))
# Kích thước ảnh khi suy luận. Lớn hơn (960/1280) giúp bắt được box nhỏ/ở xa,
# đổi lại chậm hơn và tốn RAM hơn.
IMGSZ = int(os.getenv("IMGSZ", "1280"))
# Ngưỡng IoU cho NMS. Cao hơn -> ít gộp/loại các box chồng nhau -> giữ được
# nhiều đối tượng đứng sát nhau hơn (thử 0.6 khi box xếp khít).
IOU_THRESHOLD = float(os.getenv("IOU_THRESHOLD", "0.6"))
# Lọc theo diện tích bounding box tính bằng % diện tích ảnh (không phụ thuộc
# độ phân giải). Box nhỏ hơn ngưỡng bị bỏ qua (vật ở xa / nhận nhầm).
# Ví dụ 0.5 = bỏ box chiếm dưới 0.5% diện tích ảnh. Đặt 0 để tắt lọc.
MIN_BOX_AREA_PCT = float(os.getenv("MIN_BOX_AREA_PCT", "0.5"))

# ── Tiền xử lý ảnh đầu vào (giúp model đếm chính xác hơn) ──────────────────
# Sửa hướng ảnh theo EXIF: ảnh chụp điện thoại hay bị xoay -> không sửa thì
# model nhìn ảnh nằm ngang và đếm sai. Nên để bật.
PREPROCESS_EXIF = _env_bool("PREPROCESS_EXIF", True)
# Cân bằng tương phản tự động: hữu ích cho ảnh thiếu sáng / ngược sáng.
PREPROCESS_AUTOCONTRAST = _env_bool("PREPROCESS_AUTOCONTRAST", True)
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
    "| exif=%s autocontrast=%s sharpen=%s",
    CLASS_NAMES, CONF_THRESHOLD, IMGSZ, IOU_THRESHOLD, MIN_BOX_AREA_PCT,
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


def count_boxes(image: Image.Image) -> int:
    """Đếm số object thuộc lớp box trong một ảnh PIL."""
    results = model.predict(
        source=image,
        conf=CONF_THRESHOLD,
        imgsz=IMGSZ,
        iou=IOU_THRESHOLD,
        verbose=False,
    )
    img_area = float(image.width * image.height)
    count = 0
    for r in results:
        for box in r.boxes:
            name = CLASS_NAMES[int(box.cls)].lower()
            if name != BOX_CLASS_NAME:
                continue
            # Lọc theo diện tích: bỏ qua box quá nhỏ (vật ở xa / nhận nhầm).
            x1, y1, x2, y2 = box.xyxy[0]
            box_area = float((x2 - x1) * (y2 - y1))
            if img_area > 0 and (box_area / img_area) * 100 < MIN_BOX_AREA_PCT:
                continue
            count += 1
    return count


@app.get("/health")
def health():
    return {
        "status": "ok",
        "classes": CLASS_NAMES,
        "conf": CONF_THRESHOLD,
        "imgsz": IMGSZ,
        "iou": IOU_THRESHOLD,
        "min_box_area_pct": MIN_BOX_AREA_PCT,
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

        n = count_boxes(image)
        total += n
        per_image.append({"filename": f.filename, "count": n})

    return {"total": total, "per_image": per_image}
