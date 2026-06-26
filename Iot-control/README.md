# Kiểm Soát Số Lô

Hệ thống quản lý số lô hàng theo chi nhánh. Chi nhánh dùng app để quét barcode SKU, nhập số lô, ngày sản xuất, HSD và số lượng.

## Tính năng

- Đăng nhập theo tài khoản chi nhánh
- Tìm kiếm SKU nhanh (quét barcode/QR bằng camera hoặc máy quét cầm tay)
- Quản lý số lô: thêm / cập nhật / xóa
- Theo dõi: ngày SX, HSD, số lượng mỗi lô
- Tổng hợp số lượng tự động theo SKU
- Admin: tạo SKU, quản lý tài khoản chi nhánh

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Backend | Go (Gin) |
| Database | SQLite (file local) |
| Frontend | React 18 + TypeScript + Vite |
| Auth | JWT (24h) |

## Cài đặt và chạy

### Yêu cầu

- [Go 1.21+](https://golang.org/dl/)
- [Node.js 18+](https://nodejs.org/)

---

### Backend

```bash
cd backend

# Tải dependencies
go mod tidy

# Chạy server (port 8080)
go run main.go
```

Database SQLite sẽ tự động tạo tại `backend/data/lot_control.db`.

Tài khoản mặc định: **admin / admin123**

---

### Frontend

```bash
cd frontend

# Cài dependencies
npm install

# Chạy dev server (port 5173)
npm run dev
```

Mở trình duyệt: http://localhost:5173

> **Quét bằng camera:** nút "📷 Quét" trên Dashboard mở camera để đọc barcode/QR (mã quét = mã SKU, tự đổ vào ô tìm kiếm). Camera trình duyệt yêu cầu **HTTPS** hoặc `localhost` — khi deploy thật phải phục vụ qua HTTPS, nếu không nút camera sẽ không hoạt động. Máy quét cầm tay (USB/Bluetooth) hoạt động như bàn phím nên dùng được ngay với ô tìm kiếm, không cần HTTPS.

---

### Build production

```bash
# Frontend
cd frontend && npm run build
# Output: frontend/dist/

# Backend
cd backend && go build -o lot-control.exe .
```

## Database Schema

```
users     – tài khoản đăng nhập (username, branch, role)
skus      – danh sách SKU (sku_code, name, unit)
lots      – số lô (lot_number, manufacture_date, expiry_date, qty, branch)
```

## API Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập |
| GET | `/api/auth/me` | Thông tin user hiện tại |
| GET | `/api/skus` | Danh sách SKU (có search `?q=`) |
| POST | `/api/skus` | Tạo SKU mới |
| GET | `/api/skus/:id` | Chi tiết SKU + danh sách lô |
| PUT | `/api/skus/:id` | Cập nhật SKU |
| DELETE | `/api/skus/:id` | Xóa SKU |
| GET | `/api/lots?sku_id=X` | Danh sách lô của SKU |
| POST | `/api/lots` | Thêm / cập nhật lô (upsert) |
| PUT | `/api/lots/:id` | Cập nhật lô |
| DELETE | `/api/lots/:id` | Xóa lô |
| GET | `/api/lots/:id/images` | Danh sách ảnh của lô |
| POST | `/api/lots/:id/images` | Tải ảnh lên lô (multipart, field `files`, nhiều file) |
| DELETE | `/api/lots/:id/images/:imageId` | Xóa ảnh của lô |
| GET | `/api/users` | Danh sách user (admin) |
| POST | `/api/users` | Tạo user (admin) |
| DELETE | `/api/users/:id` | Xóa user (admin) |

## Ví dụ luồng sử dụng

```
SKU: 422493107 — Serum Vitamin C
├── Lô LA001  qty: 48  NSX: 2024-01-01  HSD: 2025-12-31
└── Lô LA002  qty: 52  NSX: 2024-02-01  HSD: 2026-01-31
                       ─────────────────────────
                       Tổng:            100
```

1. Nhân viên đăng nhập bằng tài khoản chi nhánh
2. Quét barcode SKU → app hiển thị trang chi tiết SKU
3. Bấm "Thêm / Cập nhật lô" → nhập số lô + qty
4. Tổng số lượng tự cộng từ tất cả lô

## Quản lý tài khoản chi nhánh

Admin đăng nhập tại `/users` để:
- Tạo tài khoản nhân viên (username, mật khẩu, chi nhánh)
- Xóa tài khoản

## Cấu hình (`backend/config.yaml`)

Backend đọc cấu hình từ `backend/config.yaml` (copy từ `config.example.yaml`). File này nằm trong `.gitignore` vì chứa mật khẩu DB.

```yaml
server:
  port: 8080
  jwt_secret: lot-control-secret-2024
database:
  host: localhost
  port: 3306
  user: root
  password: ""
  name: lot_control   # app tự tạo nếu chưa có
```

Có thể ghi đè bằng biến môi trường: `SERVER_PORT`, `JWT_SECRET`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (env > config.yaml > mặc định).

### Lưu trữ ảnh (MinIO)

Ảnh bằng chứng của lô được lưu trên MinIO (S3-compatible). Khối `storage` trong `config.yaml`:

```yaml
storage:
  endpoint: localhost:9000          # endpoint nội bộ backend kết nối (docker: minio:9000)
  public_endpoint: http://localhost:9000  # gốc URL trình duyệt tải ảnh
  access_key: minioadmin
  secret_key: minioadmin123
  bucket: lot-images                # tự tạo + set policy public-read khi khởi động
  use_ssl: false
```

Ghi đè bằng env: `MINIO_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_USE_SSL`.

Khi chạy `docker compose up`, service `minio` được tạo sẵn — Console UI tại `http://localhost:9001` (user/pass `minioadmin` / `minioadmin123`), API S3 tại `:9000`. Backend tự tạo bucket và đặt quyền đọc public lúc khởi động.

## Chạy bằng Docker (MySQL + Backend)

Cần [Docker Desktop](https://www.docker.com/products/docker-desktop/). Ở thư mục gốc dự án:

```bash
docker compose up --build -d     # build + chạy nền MySQL và backend
docker compose logs -f backend   # xem log backend
docker compose ps                # trạng thái container
docker compose down              # tắt (giữ dữ liệu)
docker compose down -v           # tắt + xóa dữ liệu DB
```
./cloudflared.exe tunnel --url https://localhost:5173 --no-tls-verify

- Backend: `http://localhost:8080` — frontend (`npm run dev`) proxy `/api` vào đây, không cần đổi gì.
- MySQL: kết nối Navicat tới `localhost:3307`, user `root`, password `lot123456` (cấu hình trong `docker-compose.yml`).
- Không cần cài MySQL trên máy; container đã có sẵn. Frontend vẫn chạy ngoài Docker (`npm run dev`).
