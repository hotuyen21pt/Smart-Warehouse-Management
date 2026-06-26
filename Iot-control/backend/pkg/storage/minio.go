// Package storage cung cấp lớp trừu tượng IStorage để upload/xóa file lên
// object storage (MinIO/S3) mà không để các tầng nghiệp vụ phụ thuộc vào SDK.
package storage

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"lot-control/internal/config"
)

// IStorage là cổng lưu trữ file cho tầng nghiệp vụ.
type IStorage interface {
	// Upload đẩy dữ liệu lên bucket với key cho trước, trả về URL công khai.
	Upload(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) (string, error)
	// Remove xóa object theo key (bỏ qua nếu không tồn tại).
	Remove(ctx context.Context, objectKey string) error
}

type minioStorage struct {
	client         *minio.Client
	bucket         string
	publicEndpoint string
}

// New khởi tạo client MinIO, đảm bảo bucket tồn tại và đặt policy đọc public.
func New(cfg *config.Config) (IStorage, error) {
	s := &minioStorage{
		bucket:         cfg.Storage.Bucket,
		publicEndpoint: strings.TrimRight(cfg.Storage.PublicEndpoint, "/"),
	}

	client, err := minio.New(cfg.Storage.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.Storage.AccessKey, cfg.Storage.SecretKey, ""),
		Secure: cfg.Storage.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("khởi tạo client MinIO: %w", err)
	}
	s.client = client

	if err := s.ensureBucket(context.Background()); err != nil {
		return nil, err
	}
	return s, nil
}

// ensureBucket tạo bucket nếu chưa có và gán policy cho phép đọc public.
func (s *minioStorage) ensureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("kiểm tra bucket %q: %w", s.bucket, err)
	}
	if !exists {
		if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("tạo bucket %q: %w", s.bucket, err)
		}
	}

	// Policy cho phép đọc (GetObject) public toàn bộ bucket — ảnh kiểm đếm nội bộ.
	policy := fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/*"]
    }
  ]
}`, s.bucket)
	if err := s.client.SetBucketPolicy(ctx, s.bucket, policy); err != nil {
		return fmt.Errorf("đặt policy public cho bucket %q: %w", s.bucket, err)
	}
	return nil
}

func (s *minioStorage) Upload(ctx context.Context, objectKey string, reader io.Reader, size int64, contentType string) (string, error) {
	_, err := s.client.PutObject(ctx, s.bucket, objectKey, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("upload object %q: %w", objectKey, err)
	}
	return fmt.Sprintf("%s/%s/%s", s.publicEndpoint, s.bucket, objectKey), nil
}

func (s *minioStorage) Remove(ctx context.Context, objectKey string) error {
	return s.client.RemoveObject(ctx, s.bucket, objectKey, minio.RemoveObjectOptions{})
}
