"""Dịch vụ đếm thùng (box) bằng YOLO.

Nhận một hoặc nhiều ảnh qua HTTP, chạy model YOLO (best.pt) và trả về số
lượng object thuộc lớp "box" phát hiện được trên từng ảnh và tổng cộng.
"""

import io
import os
import logging

from fastapi import FastAPI, File, UploadFile, HTTPException
from PIL import Image
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("box-counter")

# Cấu hình qua biến môi trường.
MODEL_PATH = os.getenv("MODEL_PATH", "/app/model/best.pt")
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.5"))
# Tên lớp được tính là "thùng". Model hiện có lớp ['-', 'box'].
BOX_CLASS_NAME = os.getenv("BOX_CLASS_NAME", "box").lower()

app = FastAPI(title="Box Counter", version="1.0.0")

# Load model một lần khi khởi động (tốn vài giây).
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Không tìm thấy model tại: {MODEL_PATH}")
logger.info("Đang load model YOLO từ %s ...", MODEL_PATH)
model = YOLO(MODEL_PATH)
CLASS_NAMES = model.names
logger.info("Đã load model. Các lớp: %s | ngưỡng conf=%.2f", CLASS_NAMES, CONF_THRESHOLD)


def count_boxes(image: Image.Image) -> int:
    """Đếm số object thuộc lớp box trong một ảnh PIL."""
    results = model.predict(source=image, conf=CONF_THRESHOLD, verbose=False)
    count = 0
    for r in results:
        for cls_id in r.boxes.cls:
            name = CLASS_NAMES[int(cls_id)].lower()
            if name == BOX_CLASS_NAME:
                count += 1
    return count


@app.get("/health")
def health():
    return {"status": "ok", "classes": CLASS_NAMES, "conf": CONF_THRESHOLD}


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
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Không đọc được ảnh %s: %s", f.filename, exc)
            per_image.append({"filename": f.filename, "count": 0, "error": "ảnh không hợp lệ"})
            continue

        n = count_boxes(image)
        total += n
        per_image.append({"filename": f.filename, "count": n})

    return {"total": total, "per_image": per_image}
