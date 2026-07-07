# --- Build stage ---
# go.mod yêu cầu go 1.25 — base image phải >= phiên bản này, nếu không go build báo lỗi.
FROM golang:1.25-alpine AS build
WORKDIR /app

# Tải dependencies trước để tận dụng cache.
COPY go.mod go.sum ./
RUN go mod download

# Build binary (pure Go, không cần CGO).
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /lot-control .

# --- Runtime stage ---
FROM alpine:3.20
WORKDIR /app
# tzdata: driver pgx gọi time.LoadLocation cho TimeZone trong DSN (Asia/Ho_Chi_Minh);
# alpine không kèm sẵn dữ liệu múi giờ nên thiếu nó backend sẽ crash "unknown time zone".
RUN apk add --no-cache tzdata && adduser -D -u 10001 app
COPY --from=build /lot-control /app/lot-control
USER app
EXPOSE 8080
ENTRYPOINT ["/app/lot-control"]
