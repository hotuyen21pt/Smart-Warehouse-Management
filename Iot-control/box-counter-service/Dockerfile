FROM python:3.11-slim

WORKDIR /app

# Thư viện hệ thống cần cho OpenCV (headless) và Pillow.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# torch bản CPU (nhẹ ~200MB thay vì ~2.5GB CUDA) + tăng timeout/retries
# vì mạng chậm hay làm pip "Read timed out" khi tải wheel lớn.
# --mount=type=cache: giữ wheel đã tải trong cache BuildKit -> rebuild KHÔNG tải lại.
# (Bỏ --no-cache-dir để pip dùng được cache mount này.)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --timeout 1000 --retries 10 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY app.py .

# Local (docker-compose): model được mount qua volume tại /app/model.
# Render: không có volume mount nên bake thẳng model vào image.
# Khi chạy local, volume mount sẽ ghi đè thư mục này — vẫn tương thích.
COPY model/ ./model/

ENV MODEL_PATH=/app/model/best.pt \
    CONF_THRESHOLD=0.55

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
