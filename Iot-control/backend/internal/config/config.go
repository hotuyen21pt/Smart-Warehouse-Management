package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config là toàn bộ cấu hình. Nguồn ưu tiên: biến môi trường > config.yaml > mặc định.
type Config struct {
	Server struct {
		Port      int    `yaml:"port"`
		JWTSecret string `yaml:"jwt_secret"`
	} `yaml:"server"`
	Database struct {
		// URL: chuỗi kết nối đầy đủ (vd Render: postgres://user:pass@host:port/db).
		// Nếu có, dùng thẳng và bỏ qua các trường rời bên dưới.
		URL      string `yaml:"url"`
		Host     string `yaml:"host"`
		Port     int    `yaml:"port"`
		User     string `yaml:"user"`
		Password string `yaml:"password"`
		Name     string `yaml:"name"`
		SSLMode  string `yaml:"sslmode"`
	} `yaml:"database"`
	Storage struct {
		// Endpoint nội bộ để SDK kết nối MinIO (vd "minio:9000" trong docker, "localhost:9000" khi dev).
		Endpoint string `yaml:"endpoint"`
		// PublicEndpoint là gốc URL dùng để dựng link ảnh trả về cho client (vd "http://localhost:9000").
		// Tách riêng vì endpoint nội bộ (tên service docker) thường không truy cập được từ trình duyệt.
		PublicEndpoint string `yaml:"public_endpoint"`
		AccessKey      string `yaml:"access_key"`
		SecretKey      string `yaml:"secret_key"`
		Bucket         string `yaml:"bucket"`
		UseSSL         bool   `yaml:"use_ssl"`
	} `yaml:"storage"`
	BoxCounter struct {
		// URL gốc của dịch vụ đếm box (vd "http://box-counter:8000").
		// Rỗng = tắt tính năng đếm tự động.
		URL string `yaml:"url"`
	} `yaml:"box_counter"`
}

// DatabaseDSN trả về DSN cho GORM PostgreSQL.
// Ưu tiên URL đầy đủ (Render cung cấp sẵn), nếu không thì ghép từ các trường rời.
func (c *Config) DatabaseDSN() string {
	if c.Database.URL != "" {
		return c.Database.URL
	}
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=Asia/Ho_Chi_Minh",
		c.Database.Host, c.Database.Port, c.Database.User,
		c.Database.Password, c.Database.Name, c.Database.SSLMode,
	)
}

// Load đọc config.yaml (nếu có), cho phép biến môi trường ghi đè, rồi điền mặc định.
// Thiếu file không phải lỗi — phù hợp khi chạy trong Docker/Render (chỉ dùng env).
func Load(path string) (*Config, error) {
	var cfg Config

	if data, err := os.ReadFile(path); err == nil {
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("phân tích YAML %q: %w", path, err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("đọc file config %q: %w", path, err)
	}

	// Ghi đè bằng biến môi trường (nếu có) — dùng cho Docker/Render.
	if v := os.Getenv("SERVER_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = n
		}
	}
	// Render đặt PORT; hỗ trợ luôn để khỏi cần khai báo SERVER_PORT.
	if v := os.Getenv("PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = n
		}
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.Server.JWTSecret = v
	}
	// DATABASE_URL: Render cung cấp chuỗi kết nối Postgres đầy đủ.
	if v := os.Getenv("DATABASE_URL"); v != "" {
		cfg.Database.URL = v
	}
	if v := os.Getenv("DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("DB_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Database.Port = n
		}
	}
	if v := os.Getenv("DB_USER"); v != "" {
		cfg.Database.User = v
	}
	if v, ok := os.LookupEnv("DB_PASSWORD"); ok {
		cfg.Database.Password = v
	}
	if v := os.Getenv("DB_NAME"); v != "" {
		cfg.Database.Name = v
	}
	if v := os.Getenv("DB_SSLMODE"); v != "" {
		cfg.Database.SSLMode = v
	}
	// MinIO / object storage — ghi đè bằng env (dùng cho Docker/Render).
	if v := os.Getenv("MINIO_ENDPOINT"); v != "" {
		cfg.Storage.Endpoint = v
	}
	if v := os.Getenv("MINIO_PUBLIC_ENDPOINT"); v != "" {
		cfg.Storage.PublicEndpoint = v
	}
	if v := os.Getenv("MINIO_ACCESS_KEY"); v != "" {
		cfg.Storage.AccessKey = v
	}
	if v, ok := os.LookupEnv("MINIO_SECRET_KEY"); ok {
		cfg.Storage.SecretKey = v
	}
	if v := os.Getenv("MINIO_BUCKET"); v != "" {
		cfg.Storage.Bucket = v
	}
	if v := os.Getenv("MINIO_USE_SSL"); v != "" {
		cfg.Storage.UseSSL = v == "true" || v == "1"
	}
	// Dịch vụ đếm box (computer vision) — ghi đè bằng env.
	if v := os.Getenv("BOX_COUNTER_URL"); v != "" {
		cfg.BoxCounter.URL = v
	}

	// Giá trị mặc định.
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.JWTSecret == "" {
		cfg.Server.JWTSecret = "lot-control-secret-2024"
	}
	if cfg.Database.Host == "" {
		cfg.Database.Host = "localhost"
	}
	if cfg.Database.Port == 0 {
		cfg.Database.Port = 5432
	}
	if cfg.Database.User == "" {
		cfg.Database.User = "postgres"
	}
	if cfg.Database.Name == "" {
		cfg.Database.Name = "lot_control"
	}
	if cfg.Database.SSLMode == "" {
		cfg.Database.SSLMode = "disable"
	}
	if cfg.Storage.Endpoint == "" {
		cfg.Storage.Endpoint = "localhost:9000"
	}
	if cfg.Storage.PublicEndpoint == "" {
		// Mặc định dựng từ endpoint nội bộ (phù hợp khi chạy local).
		scheme := "http"
		if cfg.Storage.UseSSL {
			scheme = "https"
		}
		cfg.Storage.PublicEndpoint = scheme + "://" + cfg.Storage.Endpoint
	}
	if cfg.Storage.AccessKey == "" {
		cfg.Storage.AccessKey = "minioadmin"
	}
	if cfg.Storage.SecretKey == "" {
		cfg.Storage.SecretKey = "minioadmin123"
	}
	if cfg.Storage.Bucket == "" {
		cfg.Storage.Bucket = "lot-images"
	}

	return &cfg, nil
}
