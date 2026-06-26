package models

import "time"

type User struct {
	ID           int64     `json:"id" gorm:"primaryKey"`
	Username     string    `json:"username" gorm:"column:username;uniqueIndex;size:100;not null"`
	PasswordHash string    `json:"-" gorm:"column:password_hash;size:255;not null"`
	FullName     string    `json:"full_name" gorm:"column:full_name;size:200;not null;default:''"`
	Branch       string    `json:"branch" gorm:"column:branch;size:100;not null;default:''"`
	Role         string    `json:"role" gorm:"column:role;size:50;not null;default:'staff'"`
	CreatedAt    time.Time `json:"created_at" gorm:"column:created_at"`
}

func (User) TableName() string { return "users" }

type SKU struct {
	ID        int64     `json:"id" gorm:"primaryKey"`
	SKUCode   string    `json:"sku_code" gorm:"column:sku_code;uniqueIndex;size:100;not null"`
	Name      string    `json:"name" gorm:"column:name;size:255;not null"`
	Unit      string    `json:"unit" gorm:"column:unit;size:50;not null;default:'cái'"`
	TotalQty  int       `json:"total_qty" gorm:"-"`
	LotCount  int       `json:"lot_count" gorm:"-"`
	CreatedAt time.Time `json:"created_at" gorm:"column:created_at"`
	UpdatedAt time.Time `json:"updated_at" gorm:"column:updated_at"`
	Lots      []Lot     `json:"lots,omitempty" gorm:"-"`
}

func (SKU) TableName() string { return "skus" }

type Lot struct {
	ID              int64     `json:"id" gorm:"primaryKey"`
	SKUID           int64     `json:"sku_id" gorm:"column:sku_id;not null;uniqueIndex:idx_sku_lot"`
	SKUCode         string    `json:"sku_code,omitempty" gorm:"-"`
	LotNumber       string    `json:"lot_number" gorm:"column:lot_number;size:100;not null;uniqueIndex:idx_sku_lot"`
	ManufactureDate string    `json:"manufacture_date" gorm:"column:manufacture_date;size:50;not null;default:''"`
	ExpiryDate      string    `json:"expiry_date" gorm:"column:expiry_date;size:50;not null;default:''"`
	Qty             int       `json:"qty" gorm:"column:qty;not null;default:0"`
	Branch          string    `json:"branch" gorm:"column:branch;size:100;not null;default:''"`
	CountedByID     *int64    `json:"counted_by" gorm:"column:counted_by"`
	CountedByName   string    `json:"counted_by_name" gorm:"-"`
	CountedAt       time.Time `json:"counted_at" gorm:"column:counted_at"`
	Notes           string    `json:"notes" gorm:"column:notes;size:1000;not null;default:''"`
	Images          []LotImage `json:"images,omitempty" gorm:"-"`
}

func (Lot) TableName() string { return "lots" }

// LotImage là ảnh bằng chứng gắn với một lô (1 lô có nhiều ảnh).
type LotImage struct {
	ID        int64     `json:"id" gorm:"primaryKey"`
	LotID     int64     `json:"lot_id" gorm:"column:lot_id;not null;index"`
	ObjectKey string    `json:"-" gorm:"column:object_key;size:500;not null"`
	URL       string    `json:"url" gorm:"column:url;size:1000;not null"`
	// Count là số box đếm được trên chính ảnh này (để khi xóa ảnh thì trừ đúng số đã cộng).
	Count     int       `json:"count" gorm:"column:count;not null;default:0"`
	CreatedAt time.Time `json:"created_at" gorm:"column:created_at"`
}

func (LotImage) TableName() string { return "lot_images" }

// Claims là payload JWT, được AuthMiddleware nạp vào gin.Context.
type Claims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	Branch   string `json:"branch"`
	Role     string `json:"role"`
}
