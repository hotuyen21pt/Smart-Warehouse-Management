package usecase

import (
	"context"
	"fmt"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"lot-control/internal/models"
	httperrors "lot-control/pkg/httperrors"
)

// maxImageSize giới hạn dung lượng mỗi ảnh: 10MB.
const maxImageSize = 10 << 20

// allowedImageTypes là các content-type ảnh được chấp nhận.
var allowedImageTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
	"image/gif":  true,
}

func (uc *lotUseCase) UploadImages(ctx context.Context, lotID int64, files []*multipart.FileHeader) ([]models.LotImage, error) {
	exists, err := uc.lotRepo.LotExists(lotID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, httperrors.NewNotFound("không tìm thấy lô")
	}
	if len(files) == 0 {
		return nil, httperrors.NewBadRequest("không có file nào được tải lên")
	}

	saved := make([]models.LotImage, 0, len(files))
	for _, fh := range files {
		img, err := uc.uploadOne(ctx, lotID, fh)
		if err != nil {
			return nil, err
		}
		saved = append(saved, *img)
	}
	return saved, nil
}

func (uc *lotUseCase) uploadOne(ctx context.Context, lotID int64, fh *multipart.FileHeader) (*models.LotImage, error) {
	if fh.Size > maxImageSize {
		return nil, httperrors.NewBadRequest(fmt.Sprintf("ảnh %q vượt quá 10MB", fh.Filename))
	}

	contentType := fh.Header.Get("Content-Type")
	if !allowedImageTypes[contentType] {
		return nil, httperrors.NewBadRequest(fmt.Sprintf("định dạng %q không được hỗ trợ (chỉ JPEG/PNG/WebP/GIF)", contentType))
	}

	file, err := fh.Open()
	if err != nil {
		return nil, httperrors.NewBadRequest(fmt.Sprintf("không đọc được file %q", fh.Filename))
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	objectKey := fmt.Sprintf("lots/%d/%s%s", lotID, uuid.NewString(), ext)

	url, err := uc.storage.Upload(ctx, objectKey, file, fh.Size, contentType)
	if err != nil {
		uc.logger.Errorf("upload ảnh lô %d thất bại: %v", lotID, err)
		return nil, httperrors.NewInternal("không tải được ảnh lên kho lưu trữ")
	}

	img := &models.LotImage{
		LotID:     lotID,
		ObjectKey: objectKey,
		URL:       url,
	}
	if err := uc.lotRepo.CreateImage(img); err != nil {
		// Cố gắng dọn object đã upload để không để rác.
		if rmErr := uc.storage.Remove(ctx, objectKey); rmErr != nil {
			uc.logger.Warnf("không dọn được object %q sau lỗi DB: %v", objectKey, rmErr)
		}
		return nil, err
	}
	return img, nil
}
