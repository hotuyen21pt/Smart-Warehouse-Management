package repository

import (
	"lot-control/internal/models"
	httperrors "lot-control/pkg/httperrors"
)

func (r *lotRepository) LotExists(lotID int64) (bool, error) {
	var count int64
	if err := r.db.Model(&models.Lot{}).Where("id = ?", lotID).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *lotRepository) CreateImage(img *models.LotImage) error {
	return r.db.Create(img).Error
}

func (r *lotRepository) ListImagesByLot(lotID int64) ([]models.LotImage, error) {
	var images []models.LotImage
	err := r.db.Where("lot_id = ?", lotID).Order("created_at ASC, id ASC").Find(&images).Error
	if err != nil {
		return nil, err
	}
	return images, nil
}

func (r *lotRepository) GetImageByID(imageID int64) (*models.LotImage, error) {
	var img models.LotImage
	err := r.db.Where("id = ?", imageID).Limit(1).Find(&img).Error
	if err != nil {
		return nil, err
	}
	if img.ID == 0 {
		return nil, httperrors.NewNotFound("không tìm thấy ảnh")
	}
	return &img, nil
}

func (r *lotRepository) DeleteImage(imageID int64) error {
	res := r.db.Delete(&models.LotImage{}, imageID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return httperrors.NewNotFound("không tìm thấy ảnh")
	}
	return nil
}
