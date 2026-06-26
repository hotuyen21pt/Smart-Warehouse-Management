package httphandler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	httperrors "lot-control/pkg/httperrors"
)

// CountBoxes nhận các ảnh và trả về số box đếm được (chuyển tiếp tới dịch vụ CV).
func (handler *lotHandler) CountBoxes(ctx *gin.Context) {
	form, err := ctx.MultipartForm()
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "form không hợp lệ: " + err.Error()})
		return
	}
	files := form.File["files"]

	res, err := handler.uc.CountBoxes(ctx, files)
	if err != nil {
		ctx.AbortWithStatusJSON(httperrors.GetStatusCode(err), httperrors.ResponseError{Message: err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, res)
}
