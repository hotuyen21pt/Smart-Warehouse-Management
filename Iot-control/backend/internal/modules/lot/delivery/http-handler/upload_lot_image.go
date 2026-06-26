package httphandler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	httperrors "lot-control/pkg/httperrors"
)

func (handler *lotHandler) UploadImages(ctx *gin.Context) {
	lotID, err := strconv.ParseInt(ctx.Param("id"), 10, 64)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "id không hợp lệ"})
		return
	}

	form, err := ctx.MultipartForm()
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusBadRequest, httperrors.ResponseError{Message: "form không hợp lệ: " + err.Error()})
		return
	}
	files := form.File["files"]

	// counts đi song song với files theo thứ tự; phần tử lỗi/thiếu coi như 0.
	counts := make([]int, len(form.Value["counts"]))
	for i, c := range form.Value["counts"] {
		n, convErr := strconv.Atoi(c)
		if convErr != nil {
			n = 0
		}
		counts[i] = n
	}

	res, err := handler.uc.UploadImages(ctx, lotID, files, counts)
	if err != nil {
		ctx.AbortWithStatusJSON(httperrors.GetStatusCode(err), httperrors.ResponseError{Message: err.Error()})
		return
	}
	ctx.JSON(http.StatusCreated, res)
}
