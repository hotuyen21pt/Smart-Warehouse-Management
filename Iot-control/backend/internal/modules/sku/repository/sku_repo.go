package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"lot-control/internal/models"
	"lot-control/internal/modules/sku/dto"
	httperrors "lot-control/pkg/httperrors"
)

type ISKURepository interface {
	List(q string) ([]models.SKU, error)
	Create(params *dto.CreateSKURequest) (*models.SKU, error)
	GetDetail(id int64) (*models.SKU, error)
	Update(id int64, params *dto.UpdateSKURequest) error
	Delete(id int64) error
}

type skuRepository struct {
	db *gorm.DB
}

func InitSKURepository(db *gorm.DB) ISKURepository {
	return &skuRepository{db: db}
}

// skuScan nhận kết quả truy vấn SKU kèm tổng số lượng và số lô.
type skuScan struct {
	ID        int64     `gorm:"column:id"`
	SKUCode   string    `gorm:"column:sku_code"`
	Name      string    `gorm:"column:name"`
	Unit      string    `gorm:"column:unit"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
	TotalQty  int       `gorm:"column:total_qty"`
	LotCount  int       `gorm:"column:lot_count"`
}

func (r skuScan) toModel() models.SKU {
	return models.SKU{
		ID:        r.ID,
		SKUCode:   r.SKUCode,
		Name:      r.Name,
		Unit:      r.Unit,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
		TotalQty:  r.TotalQty,
		LotCount:  r.LotCount,
	}
}

const skuSelect = `s.id, s.sku_code, s.name, s.unit, s.created_at, s.updated_at,
	COALESCE(SUM(l.qty), 0) as total_qty, COUNT(l.id) as lot_count`

// lotScan dùng để nạp danh sách lô kèm tên người kiểm khi lấy chi tiết SKU.
type lotScan struct {
	ID              int64     `gorm:"column:id"`
	SKUID           int64     `gorm:"column:sku_id"`
	LotNumber       string    `gorm:"column:lot_number"`
	ManufactureDate string    `gorm:"column:manufacture_date"`
	ExpiryDate      string    `gorm:"column:expiry_date"`
	Qty             int       `gorm:"column:qty"`
	Branch          string    `gorm:"column:branch"`
	CountedBy       *int64    `gorm:"column:counted_by"`
	CountedByName   string    `gorm:"column:counted_by_name"`
	CountedAt       time.Time `gorm:"column:counted_at"`
	Notes           string    `gorm:"column:notes"`
}

const lotSelect = `l.id, l.sku_id, l.lot_number, l.manufacture_date, l.expiry_date, l.qty,
	l.branch, l.counted_by, COALESCE(u.full_name, '') as counted_by_name, l.counted_at, l.notes`

func (r *skuRepository) lotsBySKU(skuID int64) ([]models.Lot, error) {
	var rows []lotScan
	err := r.db.Table("lots l").
		Select(lotSelect).
		Joins("LEFT JOIN users u ON u.id = l.counted_by").
		Where("l.sku_id = ?", skuID).
		Order("l.lot_number ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	lots := make([]models.Lot, 0, len(rows))
	for _, row := range rows {
		lots = append(lots, models.Lot{
			ID:              row.ID,
			SKUID:           row.SKUID,
			LotNumber:       row.LotNumber,
			ManufactureDate: row.ManufactureDate,
			ExpiryDate:      row.ExpiryDate,
			Qty:             row.Qty,
			Branch:          row.Branch,
			CountedByID:     row.CountedBy,
			CountedByName:   row.CountedByName,
			CountedAt:       row.CountedAt,
			Notes:           row.Notes,
		})
	}
	return lots, nil
}

func (r *skuRepository) List(q string) ([]models.SKU, error) {
	tx := r.db.Table("skus s").
		Select(skuSelect).
		Joins("LEFT JOIN lots l ON l.sku_id = s.id")

	if q != "" {
		like := "%" + q + "%"
		// ILIKE: tìm không phân biệt hoa/thường (Postgres; MySQL LIKE vốn đã không phân biệt).
		tx = tx.Where("s.sku_code ILIKE ? OR s.name ILIKE ?", like, like)
	}

	var rows []skuScan
	if err := tx.Group("s.id").Order("s.updated_at DESC").Scan(&rows).Error; err != nil {
		return nil, err
	}

	skus := make([]models.SKU, 0, len(rows))
	for _, row := range rows {
		skus = append(skus, row.toModel())
	}
	return skus, nil
}

func (r *skuRepository) Create(params *dto.CreateSKURequest) (*models.SKU, error) {
	sku := models.SKU{
		SKUCode: params.SKUCode,
		Name:    params.Name,
		Unit:    params.Unit,
	}
	if err := r.db.Create(&sku).Error; err != nil {
		if isDuplicate(err) {
			return nil, httperrors.NewConflict("mã SKU đã tồn tại")
		}
		return nil, err
	}
	return &sku, nil
}

func (r *skuRepository) GetDetail(id int64) (*models.SKU, error) {
	var row skuScan
	err := r.db.Table("skus s").
		Select(skuSelect).
		Joins("LEFT JOIN lots l ON l.sku_id = s.id").
		Where("s.id = ?", id).
		Group("s.id").
		Limit(1).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, httperrors.NewNotFound("không tìm thấy SKU")
	}

	sku := row.toModel()
	lots, err := r.lotsBySKU(id)
	if err != nil {
		return nil, err
	}
	sku.Lots = lots
	return &sku, nil
}

func (r *skuRepository) Update(id int64, params *dto.UpdateSKURequest) error {
	res := r.db.Model(&models.SKU{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":       params.Name,
		"unit":       params.Unit,
		"updated_at": time.Now(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return httperrors.NewNotFound("không tìm thấy SKU")
	}
	return nil
}

func (r *skuRepository) Delete(id int64) error {
	// Xóa SKU và tất cả lô liên quan trong một transaction.
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("sku_id = ?", id).Delete(&models.Lot{}).Error; err != nil {
			return err
		}
		res := tx.Delete(&models.SKU{}, id)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return httperrors.NewNotFound("không tìm thấy SKU")
		}
		return nil
	})
	return err
}

// isDuplicate nhận biết lỗi trùng khóa, dựa trên lỗi GORM đã được
// chuẩn hóa (cần gorm.Config{TranslateError: true} khi mở kết nối).
func isDuplicate(err error) bool {
	return errors.Is(err, gorm.ErrDuplicatedKey)
}
