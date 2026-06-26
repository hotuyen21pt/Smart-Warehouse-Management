package db

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"lot-control/internal/config"
	"lot-control/internal/models"
)

// Init kết nối GORM tới PostgreSQL, chạy migrate và seed.
// (Database phải tồn tại sẵn — trên Render là DB được tạo lúc khởi tạo dịch vụ;
//  ở local là DB do docker-compose tạo qua POSTGRES_DB.)
func Init(cfg *config.Config) (*gorm.DB, error) {
	gdb, err := gorm.Open(postgres.Open(cfg.DatabaseDSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
		// Dịch lỗi của driver sang lỗi GORM chung (vd gorm.ErrDuplicatedKey),
		// nhờ đó repository không phải phụ thuộc mã lỗi riêng của Postgres.
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("GORM mở kết nối PostgreSQL (kiểm tra DATABASE_URL/DB_* trong cấu hình): %w", err)
	}

	// Tạo/cập nhật bảng.
	if err := gdb.AutoMigrate(&models.User{}, &models.SKU{}, &models.Lot{}, &models.LotImage{}); err != nil {
		return nil, fmt.Errorf("automigrate: %w", err)
	}

	// Tạo tài khoản admin mặc định nếu chưa có.
	if err := seed(gdb); err != nil {
		return nil, fmt.Errorf("seed: %w", err)
	}

	return gdb, nil
}

func seed(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.User{}).Where("username = ?", "admin").Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	admin := models.User{
		Username:     "admin",
		PasswordHash: string(hash),
		FullName:     "Administrator",
		Branch:       "HQ",
		Role:         "admin",
	}
	return db.Create(&admin).Error
}
