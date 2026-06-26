FROM python:3.11-slim

WORKDIR /app

# Thư viện hệ thống cần cho OpenCV (headless) và Pillow.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Local (docker-compose): model được mount qua volume tại /app/model.
# Render: không có volume mount nên bake thẳng model vào image.
# Khi chạy local, volume mount sẽ ghi đè thư mục này — vẫn tương thích.
COPY model/ ./model/

ENV MODEL_PATH=/app/model/best.pt \
    CONF_THRESHOLD=0.25

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
