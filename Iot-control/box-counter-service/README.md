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

Phản hồi:
```json
{
  "total": 42,
  "per_image": [
    { "filename": "a.jpg", "count": 20 },
    { "filename": "b.jpg", "count": 22 }
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
| `BOX_CLASS_NAME` | `box`               | Tên lớp được tính là "thùng"              |

## Chạy local (không Docker)

```bash
pip install -r requirements.txt
MODEL_PATH=./model/best.pt uvicorn app:app --host 0.0.0.0 --port 8000
```
