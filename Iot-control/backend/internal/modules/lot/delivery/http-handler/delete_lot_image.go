package httphandler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	httperrors "lot-control/pkg/httperrors"
)

func (handler *lotHandler) DeleteImage(ctx *gin.Context) {
	lotID, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "id không hợp lệ"})
		return
	}
	imageID, err := strconv.ParseInt(ctx.Param("imageId"), 10, 64)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "imageId không hợp lệ"})
		return
	}

	if err := handler.uc.DeleteImage(ctx, lotID, imageID); err != nil {
		ctx.AbortWithStatusJSON(httperrors.GetStatusCode(err), httperrors.ResponseError{Message: err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"message": "đã xóa ảnh"})
}
