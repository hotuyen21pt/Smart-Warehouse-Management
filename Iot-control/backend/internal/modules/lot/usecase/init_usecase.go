package usecase

import (
	"lot-control/internal/config"
	"lot-control/internal/modules/lot/repository"
	"lot-control/pkg/logger"
	"lot-control/pkg/storage"
)

type lotUseCase struct {
	cfg     *config.Config
	logger  logger.ILogger
	lotRepo repository.ILotRepository
	storage storage.IStorage
}

func InitUseCase(cfg *config.Config, log logger.ILogger, lotRepo repository.ILotRepository, store storage.IStorage) IUseCase {
	return &lotUseCase{cfg: cfg, logger: log, lotRepo: lotRepo, storage: store}
}
