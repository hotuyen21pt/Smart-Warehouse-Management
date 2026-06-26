package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	httperrors "lot-control/pkg/httperrors"
)

// BoxCountResult là kết quả đếm box trả về từ dịch vụ CV.
type BoxCountResult struct {
	Total    int            `json:"total"`
	PerImage []BoxCountItem `json:"per_image"`
}

// BoxCountItem là số box đếm được trên một ảnh.
type BoxCountItem struct {
	Filename string `json:"filename"`
	Count    int    `json:"count"`
	Error    string `json:"error,omitempty"`
}

// CountBoxes chuyển tiếp các ảnh sang dịch vụ box-counter và trả về số lượng đếm được.
func (uc *lotUseCase) CountBoxes(ctx context.Context, files []*multipart.FileHeader) (*BoxCountResult, error) {
	if uc.cfg.BoxCounter.URL == "" {
		return nil, httperrors.NewBadRequest("tính năng đếm box chưa được cấu hình")
	}
	if len(files) == 0 {
		return nil, httperrors.NewBadRequest("không có ảnh nào để đếm")
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for _, fh := range files {
		src, err := fh.Open()
		if err != nil {
			return nil, httperrors.NewBadRequest("không đọc được ảnh tải lên")
		}
		part, err := writer.CreateFormFile("files", fh.Filename)
		if err != nil {
			src.Close()
			return nil, httperrors.NewInternal("không tạo được form gửi đi")
		}
		if _, err := io.Copy(part, src); err != nil {
			src.Close()
			return nil, httperrors.NewInternal("lỗi đọc dữ liệu ảnh")
		}
		src.Close()
	}
	if err := writer.Close(); err != nil {
		return nil, httperrors.NewInternal("lỗi đóng form gửi đi")
	}

	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	url := strings.TrimRight(uc.cfg.BoxCounter.URL, "/") + "/count"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, body)
	if err != nil {
		return nil, httperrors.NewInternal("không tạo được request đếm box")
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		uc.logger.Errorf("gọi dịch vụ box-counter thất bại: %v", err)
		return nil, httperrors.NewInternal("không gọi được dịch vụ đếm box")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		uc.logger.Errorf("box-counter trả về mã %d: %s", resp.StatusCode, string(b))
		return nil, httperrors.NewInternal("dịch vụ đếm box gặp lỗi")
	}

	var result BoxCountResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, httperrors.NewInternal("phản hồi từ dịch vụ đếm box không hợp lệ")
	}
	return &result, nil
}
