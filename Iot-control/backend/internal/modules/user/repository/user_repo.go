package repository

import (
	"errors"

	"gorm.io/gorm"

	"lot-control/internal/models"
	httperrors "lot-control/pkg/httperrors"
)

type IUserRepository interface {
	List() ([]models.User, error)
	Create(user *models.User) error
	GetByID(id int64) (*models.User, error)
	Delete(id int64) error
}

type userRepository struct {
	db *gorm.DB
}

func InitUserRepository(db *gorm.DB) IUserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) List() ([]models.User, error) {
	users := []models.User{}
	if err := r.db.Order("id").Find(&users).Error; err != nil {
		return nil, err
	}
	return users, nil
}

func (r *userRepository) Create(user *models.User) error {
	if err := r.db.Create(user).Error; err != nil {
		if isDuplicate(err) {
			return httperrors.NewConflict("tên đăng nhập đã tồn tại")
		}
		return err
	}
	return nil
}

func (r *userRepository) GetByID(id int64) (*models.User, error) {
	var user models.User
	err := r.db.First(&user, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, httperrors.NewNotFound("không tìm thấy user")
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepository) Delete(id int64) error {
	return r.db.Delete(&models.User{}, id).Error
}

// isDuplicate nhận biết lỗi trùng khóa, dựa trên lỗi GORM đã được
// chuẩn hóa (cần gorm.Config{TranslateError: true} khi mở kết nối).
func isDuplicate(err error) bool {
	return errors.Is(err, gorm.ErrDuplicatedKey)
}
