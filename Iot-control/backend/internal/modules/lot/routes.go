package lot

import (
	"github.com/gin-gonic/gin"

	"lot-control/internal/config"
	"lot-control/internal/middleware"
	httphandler "lot-control/internal/modules/lot/delivery/http-handler"
	"lot-control/internal/modules/lot/usecase"
)

func RegisterRoutes(rg *gin.RouterGroup, cfg *config.Config, uc usecase.IUseCase) {
	h := httphandler.InitHandler(cfg, uc)
	grp := rg.Group("/lots")
	{
		grp.GET("", middleware.AuthMiddleware(cfg, ""), h.List)
		grp.POST("", middleware.AuthMiddleware(cfg, ""), h.Upsert)
		grp.POST("/count-boxes", middleware.AuthMiddleware(cfg, ""), h.CountBoxes)
		grp.PUT("/:id", middleware.AuthMiddleware(cfg, ""), h.Update)
		grp.DELETE("/:id", middleware.AuthMiddleware(cfg, ""), h.Delete)

		// Ảnh của lô.
		grp.GET("/:id/images", middleware.AuthMiddleware(cfg, ""), h.ListImages)
		grp.POST("/:id/images", middleware.AuthMiddleware(cfg, ""), h.UploadImages)
		grp.DELETE("/:id/images/:imageId", middleware.AuthMiddleware(cfg, ""), h.DeleteImage)
	}
}
