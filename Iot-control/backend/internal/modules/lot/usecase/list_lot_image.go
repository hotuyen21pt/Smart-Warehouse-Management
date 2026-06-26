package usecase

import (
	"context"

	"lot-control/internal/models"
	httperrors "lot-control/pkg/httperrors"
)

func (uc *lotUseCase) ListImages(ctx context.Context, lotID int64) ([]models.LotImage, error) {
	exists, err := uc.lotRepo.LotExists(lotID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, httperrors.NewNotFound("không tìm thấy lô")
	}
	return uc.lotRepo.ListImagesByLot(lotID)
}
