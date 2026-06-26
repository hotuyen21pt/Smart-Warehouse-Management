package usecase

import (
	"context"
	"mime/multipart"

	"lot-control/internal/models"
	"lot-control/internal/modules/lot/dto"
)

type IUseCase interface {
	ListBySKU(ctx context.Context, skuID int64) ([]models.Lot, error)
	Upsert(ctx context.Context, params *dto.UpsertLotRequest) (*models.Lot, error)
	Update(ctx context.Context, id int64, params *dto.UpdateLotRequest) (*models.Lot, error)
	Delete(ctx context.Context, id int64) error

	// Ảnh của lô.
	ListImages(ctx context.Context, lotID int64) ([]models.LotImage, error)
	UploadImages(ctx context.Context, lotID int64, files []*multipart.FileHeader, counts []int) ([]models.LotImage, error)
	DeleteImage(ctx context.Context, lotID, imageID int64) error

	// Đếm box bằng computer vision.
	CountBoxes(ctx context.Context, files []*multipart.FileHeader) (*BoxCountResult, error)
}
