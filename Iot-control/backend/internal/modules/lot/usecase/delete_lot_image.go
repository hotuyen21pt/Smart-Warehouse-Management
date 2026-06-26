package usecase

import (
	"context"

	httperrors "lot-control/pkg/httperrors"
)

func (uc *lotUseCase) DeleteImage(ctx context.Context, lotID, imageID int64) error {
	img, err := uc.lotRepo.GetImageByID(imageID)
	if err != nil {
		return err
	}
	// Đảm bảo ảnh thuộc đúng lô trên URL (tránh xóa nhầm qua lô khác).
	if img.LotID != lotID {
		return httperrors.NewNotFound("không tìm thấy ảnh trong lô này")
	}

	if err := uc.lotRepo.DeleteImage(imageID); err != nil {
		return err
	}

	// Xóa object khỏi kho lưu trữ; lỗi ở đây không chặn nghiệp vụ (DB đã sạch).
	if err := uc.storage.Remove(ctx, img.ObjectKey); err != nil {
		uc.logger.Warnf("không xóa được object %q khỏi kho lưu trữ: %v", img.ObjectKey, err)
	}
	return nil
}
