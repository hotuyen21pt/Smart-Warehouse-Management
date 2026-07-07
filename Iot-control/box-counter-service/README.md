# Box Counter Service

Dịch vụ HTTP đếm số thùng (box) trong ảnh bằng model YOLO (`best.pt`).
Được backend Go gọi tới khi người dùng tải ảnh lô để tự điền ô Số lượng.

## Model

Đặt file model tại `box-counter-service/model/best.pt`. File này được **mount**
vào container (xem `docker-compose.yml`), nên khi train lại chỉ cần thay file và
khởi động lại service — không phải build lại image:

```bash
docker compose restart box-counter
```

## API

### `POST /count`
Form-data `files`: một hoặc nhiều ảnh.

Phản hồi (toạ độ box chuẩn hoá 0..1 theo ảnh đã sửa EXIF):
```json
{
  "total": 42,
  "per_image": [
    {
      "filename": "a.jpg",
      "count": 20,
      "width": 4032,
      "height": 3024,
      "boxes": [
        { "x1": 0.10, "y1": 0.20, "x2": 0.25, "y2": 0.40, "conf": 0.87 }
      ]
    }
  ]
}
```

### `GET /health`
Kiểm tra service và xem các lớp model nhận diện.

## Biến môi trường

| Biến             | Mặc định            | Ý nghĩa                                   |
|------------------|---------------------|-------------------------------------------|
| `MODEL_PATH`     | `/app/model/best.pt`| Đường dẫn model trong container           |
| `CONF_THRESHOLD` | `0.5`               | Ngưỡng tin cậy tối thiểu                   |
| `IMGSZ`          | `960`               | Kích thước ảnh khi suy luận               |
| `IOU_THRESHOLD`  | `0.7`               | IoU cho NMS (khi tắt soft-NMS)            |
| `MIN_BOX_AREA_PCT`| `0.3`              | Bỏ box nhỏ hơn % diện tích ảnh này        |
| `SOFT_NMS`       | `true`              | Bật soft-NMS: hạ điểm box chồng thay vì loại thẳng → giảm đếm trùng khi box xếp khít |
| `SOFT_NMS_SIGMA` | `0.5`               | Nhỏ hơn = phạt mạnh box chồng             |
| `SOFT_NMS_CAND_IOU`| `0.9`             | NMS lỏng khi gom ứng viên cho soft-NMS    |
| `SOFT_NMS_CAND_CONF`| `0.2`            | Ngưỡng conf thấp khi gom ứng viên         |
| `SIZE_AWARE_CONF`| `true`              | Bật ngưỡng conf theo kích thước box       |
| `SMALL_AREA_PCT` / `CONF_SMALL` | `1.0` / `0.6` | Box < 1% diện tích cần conf ≥ 0.6 |
| `LARGE_AREA_PCT` / `CONF_LARGE` | `5.0` / `0.4` | Box > 5% diện tích chỉ cần conf ≥ 0.4 |
| `BOX_CLASS_NAME` | `box`               | Tên lớp được tính là "thùng"              |

## Chạy local (không Docker)

```bash
pip install -r requirements.txt
MODEL_PATH=./model/best.pt uvicorn app:app --host 0.0.0.0 --port 8000
```
