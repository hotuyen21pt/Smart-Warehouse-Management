package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"lot-control/internal/models"
	httperrors "lot-control/pkg/httperrors"
)

type ILotRepository interface {
	ListBySKU(skuID int64) ([]models.Lot, error)
	SKUExists(skuID int64) (bool, error)
	Upsert(lot *models.Lot) error
	TouchSKU(skuID int64) error
	GetBySKUAndLotNumber(skuID int64, lotNumber string) (*models.Lot, error)
	Update(id int64, fields map[string]interface{}) error
	GetByID(id int64) (*models.Lot, error)
	Delete(id int64) error

	// Ảnh của lô.
	LotExists(lotID int64) (bool, error)
	CreateImage(img *models.LotImage) error
	ListImagesByLot(lotID int64) ([]models.LotImage, error)
	GetImageByID(imageID int64) (*models.LotImage, error)
	DeleteImage(imageID int64) error
}

type lotRepository struct {
	db *gorm.DB
}

func InitLotRepository(db *gorm.DB) ILotRepository {
	return &lotRepository{db: db}
}

// lotScan nhận kết quả truy vấn lô có kèm tên người đếm (join users).
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

func (r lotScan) toModel() models.Lot {
	return models.Lot{
		ID:              r.ID,
		SKUID:           r.SKUID,
		LotNumber:       r.LotNumber,
		ManufactureDate: r.ManufactureDate,
		ExpiryDate:      r.ExpiryDate,
		Qty:             r.Qty,
		Branch:          r.Branch,
		CountedByID:     r.CountedBy,
		CountedByName:   r.CountedByName,
		CountedAt:       r.CountedAt,
		Notes:           r.Notes,
	}
}

const lotSelect = `l.id, l.sku_id, l.lot_number, l.manufacture_date, l.expiry_date, l.qty,
	l.branch, l.counted_by, COALESCE(u.full_name, '') as counted_by_name, l.counted_at, l.notes`

const lotJoin = `LEFT JOIN users u ON u.id = l.counted_by`

func (r *lotRepository) ListBySKU(skuID int64) ([]models.Lot, error) {
	var rows []lotScan
	err := r.db.Table("lots l").
		Select(lotSelect).
		Joins(lotJoin).
		Where("l.sku_id = ?", skuID).
		Order("l.lot_number ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	lots := make([]models.Lot, 0, len(rows))
	for _, row := range rows {
		lots = append(lots, row.toModel())
	}
	return lots, nil
}

// one lấy một lô theo điều kiện; trả về nil nếu không tìm thấy.
func (r *lotRepository) one(query string, args ...interface{}) (*models.Lot, error) {
	var row lotScan
	err := r.db.Table("lots l").
		Select(lotSelect).
		Joins(lotJoin).
		Where(query, args...).
		Limit(1).
		Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, nil
	}
	lot := row.toModel()
	return &lot, nil
}

func (r *lotRepository) SKUExists(skuID int64) (bool, error) {
	var count int64
	if err := r.db.Model(&models.SKU{}).Where("id = ?", skuID).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *lotRepository) Upsert(lot *models.Lot) error {
	// Upsert theo (sku_id, lot_number) -> MySQL ON DUPLICATE KEY UPDATE.
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "sku_id"}, {Name: "lot_number"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"manufacture_date", "expiry_date", "qty", "branch", "counted_by", "counted_at", "notes",
		}),
	}).Create(lot).Error
}

func (r *lotRepository) TouchSKU(skuID int64) error {
	return r.db.Model(&models.SKU{}).Where("id = ?", skuID).Update("updated_at", time.Now()).Error
}

func (r *lotRepository) GetBySKUAndLotNumber(skuID int64, lotNumber string) (*models.Lot, error) {
	lot, err := r.one("l.sku_id = ? AND l.lot_number = ?", skuID, lotNumber)
	if err != nil {
		return nil, err
	}
	if lot == nil {
		return nil, httperrors.NewInternal("không đọc lại được lô")
	}
	return lot, nil
}

func (r *lotRepository) Update(id int64, fields map[string]interface{}) error {
	res := r.db.Model(&models.Lot{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return httperrors.NewNotFound("không tìm thấy lô")
	}
	return nil
}

func (r *lotRepository) GetByID(id int64) (*models.Lot, error) {
	lot, err := r.one("l.id = ?", id)
	if err != nil {
		return nil, err
	}
	if lot == nil {
		return nil, httperrors.NewInternal("không đọc lại được lô")
	}
	return lot, nil
}

func (r *lotRepository) Delete(id int64) error {
	res := r.db.Delete(&models.Lot{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return httperrors.NewNotFound("không tìm thấy lô")
	}
	return nil
}
