package httphandler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	httperrors "lot-control/pkg/httperrors"
)

func (handler *lotHandler) ListImages(ctx *gin.Context) {
	lotID, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "id không hợp lệ"})
		return
	}

	res, err := handler.uc.ListImages(ctx, lotID)
	if err != nil {
		ctx.AbortWithStatusJSON(httperrors.GetStatusCode(err), httperrors.ResponseError{Message: err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, res)
}
