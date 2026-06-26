package internal

import (
	"fmt"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"lot-control/internal/config"
	"lot-control/internal/db"
	"lot-control/pkg/logger"
	"lot-control/pkg/storage"

	auth "lot-control/internal/modules/auth"
	authRepository "lot-control/internal/modules/auth/repository"
	authUsecase "lot-control/internal/modules/auth/usecase"

	lot "lot-control/internal/modules/lot"
	lotRepository "lot-control/internal/modules/lot/repository"
	lotUsecase "lot-control/internal/modules/lot/usecase"

	sku "lot-control/internal/modules/sku"
	skuRepository "lot-control/internal/modules/sku/repository"
	skuUsecase "lot-control/internal/modules/sku/usecase"

	user "lot-control/internal/modules/user"
	userRepository "lot-control/internal/modules/user/repository"
	userUsecase "lot-control/internal/modules/user/usecase"
)

// Server là composition root: giữ phụ thuộc dùng chung (db, cfg, logger)
// và nối các module lại với nhau qua chuỗi repository -> usecase -> routes.
type Server struct {
	cfg     *config.Config
	db      *gorm.DB
	logger  logger.ILogger
	engine  *gin.Engine
	storage storage.IStorage
}

func New(cfg *config.Config) (*Server, error) {
	database, err := db.Init(cfg)
	if err != nil {
		return nil, err
	}

	store, err := storage.New(cfg)
	if err != nil {
		return nil, err
	}

	s := &Server{
		cfg:     cfg,
		db:      database,
		logger:  logger.New(),
		engine:  gin.Default(),
		storage: store,
	}

	s.setupMiddleware()
	s.registerRoutes()
	return s, nil
}

func (s *Server) setupMiddleware() {
	// Cho phép truy cập từ mọi origin (localhost, IP LAN/VPN, Cloudflare Tunnel).
	// An toàn vì auth dùng JWT trong header Authorization, không dùng cookie.
	s.engine.Use(cors.New(cors.Config{
		AllowOriginFunc:  func(origin string) bool { return true },
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))
}

func (s *Server) registerRoutes() {
	api := s.engine.Group("/api")

	// Chuỗi khởi tạo: repository -> usecase cho từng module.
	authRepo := authRepository.InitAuthRepository(s.db)
	authUC := authUsecase.InitUseCase(s.cfg, s.logger, authRepo)

	skuRepo := skuRepository.InitSKURepository(s.db)
	skuUC := skuUsecase.InitUseCase(s.cfg, s.logger, skuRepo)

	lotRepo := lotRepository.InitLotRepository(s.db)
	lotUC := lotUsecase.InitUseCase(s.cfg, s.logger, lotRepo, s.storage)

	userRepo := userRepository.InitUserRepository(s.db)
	userUC := userUsecase.InitUseCase(s.cfg, s.logger, userRepo)

	// Đăng ký route từng module.
	auth.RegisterRoutes(api, s.cfg, authUC)
	sku.RegisterRoutes(api, s.cfg, skuUC)
	lot.RegisterRoutes(api, s.cfg, lotUC)
	user.RegisterRoutes(api, s.cfg, userUC)
}

func (s *Server) Run() error {
	addr := fmt.Sprintf(":%d", s.cfg.Server.Port)
	s.logger.Infof("Server listening on %s", addr)
	s.logger.Infof("Default login: admin / admin123")
	return s.engine.Run(addr)
}
