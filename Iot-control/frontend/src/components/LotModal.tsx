import { useEffect, useRef, useState } from 'react'
import {
  upsertLot,
  updateLot,
  listLotImages,
  uploadLotImages,
  updateImageBoxes,
  deleteLotImage,
  countBoxes,
} from '../api/client'
import type { Lot, LotImage, DetBox } from '../types'
import BoxReviewModal from './BoxReviewModal'
import CameraCaptureModal from './CameraCaptureModal'

// So sánh 2 danh sách box (chuẩn hoá 0..1) để biết người dùng có chỉnh tay không.
// So khớp theo thứ tự với sai số nhỏ; khác số lượng box coi như đã sửa.
const boxesEqual = (a: DetBox[], b: DetBox[]): boolean => {
  if (a.length !== b.length) return false
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-4
  return a.every((p, i) => eq(p.x1, b[i].x1) && eq(p.y1, b[i].y1) && eq(p.x2, b[i].x2) && eq(p.y2, b[i].y2))
}

interface Props {
  skuId: number
  skuCode: string
  skuName: string
  lot?: Lot
  userBranch: string
  onSave: () => void
  onClose: () => void
}

export default function LotModal({ skuId, skuCode, skuName, lot, userBranch, onSave, onClose }: Props) {
  const [form, setForm] = useState({
    lot_number: lot?.lot_number ?? '',
    manufacture_date: lot?.manufacture_date ?? '',
    expiry_date: lot?.expiry_date ?? '',
    qty: lot?.qty ?? 0,
    branch: lot?.branch ?? userBranch,
    notes: lot?.notes ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!lot?.id

  // Ảnh đã lưu trên server (chế độ sửa).
  const [images, setImages] = useState<LotImage[]>([])
  // Ảnh chọn tạm (cả tạo mới lẫn sửa) — chỉ upload khi bấm Lưu/Cập nhật.
  // count: số box trên ảnh; boxes: toạ độ box; edited: người dùng có chỉnh tay không.
  const [pending, setPending] = useState<
    { file: File; url: string; count: number; boxes: DetBox[]; edited: boolean }[]
  >([])
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState('')
  // Trạng thái đếm box tự động.
  const [counting, setCounting] = useState(false)
  const [countMsg, setCountMsg] = useState('')
  // Hàng đợi xem lại & chỉnh box cho từng ảnh vừa chọn (url để hiển thị trong modal).
  const [reviewQueue, setReviewQueue] = useState<{ file: File; boxes: DetBox[]; url: string }[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  // Kết quả đã xác nhận tích luỹ qua hàng đợi.
  const [reviewResults, setReviewResults] = useState<
    { file: File; count: number; boxes: DetBox[]; edited: boolean; url: string }[]
  >([])
  // Ảnh đang mở lại để chỉnh nhãn: 'pending' theo index, 'server' theo id ảnh.
  const [editing, setEditing] = useState<{ kind: 'pending' | 'server'; ref: number } | null>(null)
  // Box đã sửa cho ảnh server (edit mode), flush lên server khi bấm Cập nhật.
  const [serverEdits, setServerEdits] = useState<
    Record<number, { boxes: DetBox[]; edited: boolean }>
  >({})
  // Mở camera điện thoại (chụp trực tiếp trong app) thay cho input camera HĐH.
  const [showCamera, setShowCamera] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // % tiến trình cho thao tác đang chạy (đếm box / tải ảnh); null = ẩn thanh.
  const [progress, setProgress] = useState<number | null>(null)

  // Ảnh vừa xoá còn trong cửa sổ Hoàn tác (5s). Xoá server bị hoãn gọi API tới
  // khi hết giờ / bấm Lưu / đóng modal; xoá pending hoãn revoke URL.
  type PendingImg = { file: File; url: string; count: number; boxes: DetBox[]; edited: boolean }
  type UndoItem =
    | { kind: 'pending'; item: PendingImg; index: number }
    | { kind: 'server'; image: LotImage; edit?: { boxes: DetBox[]; edited: boolean } }
  const [undoItem, setUndoItem] = useState<UndoItem | null>(null)
  const undoItemRef = useRef<UndoItem | null>(null)
  undoItemRef.current = undoItem
  const undoTimerRef = useRef<number | null>(null)

  // Giải phóng các object URL còn lại khi đóng modal (cả ảnh pending lẫn hàng đợi
  // review chưa xử lý xong). Revoke trùng là vô hại (no-op).
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const reviewQueueRef = useRef(reviewQueue)
  reviewQueueRef.current = reviewQueue
  useEffect(
    () => () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url))
      reviewQueueRef.current.forEach((q) => URL.revokeObjectURL(q.url))
      // Chốt thao tác xoá còn trong cửa sổ hoàn tác (không setState sau unmount).
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
      const it = undoItemRef.current
      if (it) {
        if (it.kind === 'pending') URL.revokeObjectURL(it.item.url)
        else if (lot?.id) void deleteLotImage(lot.id, it.image.id).catch(() => {})
      }
    },
    [],
  )

  useEffect(() => {
    if (!isEdit || !lot?.id) return
    listLotImages(lot.id)
      .then(setImages)
      .catch(() => setImgError('Không tải được danh sách ảnh'))
  }, [isEdit, lot?.id])

  const resetInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Nhận diện box cho danh sách ảnh rồi mở hàng đợi xem lại (dùng chung cho
  // nút Tải ảnh lẫn chụp bằng camera điện thoại).
  const processFiles = async (files: File[]) => {
    if (files.length === 0) return
    setImgError('')

    // Đếm/phát hiện box theo từng ảnh để hiện tiến trình, rồi mở hàng đợi xem lại.
    setCounting(true)
    setProgress(0)
    const perImageBoxes: DetBox[][] = []
    let total = 0
    try {
      for (let i = 0; i < files.length; i++) {
        setCountMsg(`Đang phát hiện box… ảnh ${i + 1}/${files.length}`)
        const res = await countBoxes([files[i]])
        const bxs = res.per_image?.[0]?.boxes ?? []
        perImageBoxes.push(bxs)
        total += res.total
        setProgress(Math.round(((i + 1) / files.length) * 100))
      }
    } catch (err: any) {
      setCountMsg('')
      setProgress(null)
      setImgError(err?.response?.data?.error || 'Đếm box thất bại')
      setCounting(false)
      return
    }
    setCounting(false)
    setProgress(null)
    setCountMsg(`Đã phát hiện ${total} box — kiểm tra lại từng ảnh`)
    setReviewResults([])
    setReviewIndex(0)
    setReviewQueue(
      files.map((f, i) => ({
        file: f,
        boxes: perImageBoxes[i] ?? [],
        url: URL.createObjectURL(f),
      })),
    )
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    resetInputs()
    void processFiles(files)
  }

  type ReviewResult = { file: File; count: number; boxes: DetBox[]; edited: boolean; url: string }

  // Sau khi review hết hàng đợi: cộng tổng vào Số lượng và đưa ảnh vào luồng
  // pending. Chỉ upload thật (kèm nhãn dataset) khi bấm Lưu/Cập nhật.
  const finalizeReview = (results: ReviewResult[]) => {
    if (results.length === 0) {
      setCountMsg('')
      return
    }
    const totalCount = results.reduce((s, r) => s + r.count, 0)
    setForm((prev) => ({ ...prev, qty: Number(prev.qty || 0) + totalCount }))
    setCountMsg(`Đã thêm: +${totalCount} box`)
    setPending((prev) => [
      ...prev,
      ...results.map((r) => ({
        file: r.file,
        url: r.url,
        count: r.count,
        boxes: r.boxes,
        edited: r.edited,
      })),
    ])
  }

  // Chuyển sang ảnh tiếp theo trong hàng đợi, hoặc kết thúc.
  const advanceReview = (results: ReviewResult[]) => {
    const next = reviewIndex + 1
    if (next < reviewQueue.length) {
      setReviewResults(results)
      setReviewIndex(next)
    } else {
      finalizeReview(results)
      setReviewQueue([])
      setReviewIndex(0)
      setReviewResults([])
    }
  }

  const handleReviewConfirm = (boxes: DetBox[], count: number) => {
    const item = reviewQueue[reviewIndex]
    if (item) {
      // edited=true nếu người dùng đã thêm/xoá/sửa box so với kết quả auto-detect.
      const edited = !boxesEqual(boxes, item.boxes)
      advanceReview([...reviewResults, { file: item.file, count, boxes, edited, url: item.url }])
    } else {
      advanceReview(reviewResults)
    }
  }

  const handleReviewCancel = () => {
    // Bỏ qua ảnh hiện tại: không tính số lượng, thu hồi object URL của ảnh bị bỏ.
    const item = reviewQueue[reviewIndex]
    if (item) URL.revokeObjectURL(item.url)
    advanceReview(reviewResults)
  }

  // Mở lại một ảnh pending để chỉnh nhãn.
  const handleEditPendingConfirm = (index: number, boxes: DetBox[], count: number) => {
    setPending((prev) => {
      const old = prev[index]
      if (!old) return prev
      const delta = count - old.count
      if (delta !== 0) setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) + delta) }))
      const next = [...prev]
      next[index] = { ...old, boxes, count, edited: old.edited || !boxesEqual(boxes, old.boxes) }
      return next
    })
    setEditing(null)
  }

  // Mở lại một ảnh đã lưu trên server để chỉnh nhãn (flush khi bấm Cập nhật).
  const handleEditServerConfirm = (imageId: number, boxes: DetBox[], count: number) => {
    const img = images.find((i) => i.id === imageId)
    if (!img) {
      setEditing(null)
      return
    }
    const delta = count - img.count
    if (delta !== 0) setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) + delta) }))
    // edited: khác với box gốc từ server thì tính là chỉnh tay (ghi nhãn dataset).
    const edited = !boxesEqual(boxes, img.boxes ?? [])
    setServerEdits((prev) => ({ ...prev, [imageId]: { boxes, edited } }))
    setImages((prev) => prev.map((i) => (i.id === imageId ? { ...i, boxes, count } : i)))
    setEditing(null)
  }

  // Thực thi dứt điểm thao tác xoá đang chờ hoàn tác (hết giờ / trước khi xoá
  // cái mới / khi Lưu / khi đóng modal): pending thì revoke URL, server thì gọi
  // API xoá thật. Trả về Promise để nơi gọi có thể chờ (vd trước khi Lưu).
  const finalizeUndo = async () => {
    const it = undoItemRef.current
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoItem(null)
    undoItemRef.current = null
    if (!it) return
    if (it.kind === 'pending') {
      URL.revokeObjectURL(it.item.url)
    } else if (lot?.id) {
      try {
        await deleteLotImage(lot.id, it.image.id)
      } catch (err: any) {
        setImgError(err?.response?.data?.error || 'Xóa ảnh thất bại')
      }
    }
  }

  // Bắt đầu cửa sổ hoàn tác 5s cho một thao tác xoá.
  const startUndo = (it: UndoItem) => {
    // Chốt thao tác xoá trước đó (nếu còn) rồi mới mở cửa sổ mới.
    void finalizeUndo()
    setUndoItem(it)
    undoItemRef.current = it
    undoTimerRef.current = window.setTimeout(() => void finalizeUndo(), 5000)
  }

  // Hoàn tác: khôi phục ảnh + cộng lại số lượng đã trừ.
  const undoDelete = () => {
    const it = undoItemRef.current
    if (!it) return
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    if (it.kind === 'pending') {
      setPending((prev) => {
        const next = [...prev]
        next.splice(Math.min(it.index, next.length), 0, it.item)
        return next
      })
      setForm((f) => ({ ...f, qty: Number(f.qty || 0) + (it.item.count || 0) }))
    } else {
      setImages((prev) => [...prev, it.image].sort((a, b) => a.id - b.id))
      if (it.edit) setServerEdits((prev) => ({ ...prev, [it.image.id]: it.edit! }))
      setForm((f) => ({ ...f, qty: Number(f.qty || 0) + (it.image.count || 0) }))
    }
    setUndoItem(null)
    undoItemRef.current = null
  }

  const handleRemovePending = (index: number) => {
    const removed = pending[index]
    if (!removed) return
    setPending((prev) => prev.filter((_, i) => i !== index))
    // Bỏ ảnh tạm thì trừ lại số box của ảnh đó khỏi Số lượng.
    setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) - (removed.count || 0)) }))
    startUndo({ kind: 'pending', item: removed, index })
  }

  const handleDeleteImage = (imageId: number) => {
    if (!lot?.id) return
    setImgError('')
    const target = images.find((img) => img.id === imageId)
    if (!target) return
    // Ẩn khỏi UI ngay; API xoá thật bị hoãn để còn hoàn tác.
    const savedEdit = serverEdits[imageId]
    setImages((prev) => prev.filter((img) => img.id !== imageId))
    if (imageId in serverEdits) {
      setServerEdits((prev) => {
        const next = { ...prev }
        delete next[imageId]
        return next
      })
    }
    setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) - (target.count || 0)) }))
    startUndo({ kind: 'server', image: target, edit: savedEdit })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    // Chốt thao tác xoá còn đang chờ hoàn tác (thực hiện API xoá server nếu có).
    await finalizeUndo()
    try {
      if (isEdit) {
        await updateLot(lot.id, {
          manufacture_date: form.manufacture_date,
          expiry_date: form.expiry_date,
          qty: Number(form.qty),
          notes: form.notes,
        })
        // Flush box đã chỉnh của ảnh server (ghi/xoá nhãn dataset ở backend).
        for (const [idStr, e] of Object.entries(serverEdits)) {
          try {
            await updateImageBoxes(lot.id, Number(idStr), e.boxes, e.edited)
          } catch {
            setImgError('Cập nhật nhãn một số ảnh thất bại')
          }
        }
        setServerEdits({})
        // Upload các ảnh mới chọn tạm (kèm nhãn dataset cho ảnh chỉnh tay).
        if (pending.length > 0) {
          setProgress(0)
          try {
            await uploadLotImages(lot.id, pending, setProgress)
          } catch {
            setImgError('Lô đã được lưu nhưng tải ảnh thất bại')
          }
          setProgress(null)
          pending.forEach((p) => URL.revokeObjectURL(p.url))
          setPending([])
        }
      } else {
        const newLot = await upsertLot({
          sku_id: skuId,
          lot_number: form.lot_number,
          manufacture_date: form.manufacture_date,
          expiry_date: form.expiry_date,
          qty: Number(form.qty),
          branch: form.branch,
          notes: form.notes,
        })
        // Upload các ảnh đã chọn tạm sau khi lô được tạo (kèm nhãn dataset).
        if (pending.length > 0 && newLot?.id) {
          setProgress(0)
          try {
            await uploadLotImages(newLot.id, pending, setProgress)
          } catch {
            setImgError('Lô đã được lưu nhưng tải ảnh thất bại')
          }
          setProgress(null)
          pending.forEach((p) => URL.revokeObjectURL(p.url))
          setPending([])
        }
      }
      onSave()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      setLoading(false)
    }
  }

  const reviewing = reviewQueue.length > 0 && reviewIndex < reviewQueue.length

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">✕</button>
        <div className="modal-header modal-header-icon">
          <span className="modal-icon">{isEdit ? '✏️' : '🏷️'}</span>
          <div>
            <h2>{isEdit ? 'Cập nhật lô' : 'Thêm / Cập nhật lô'}</h2>
            <p className="modal-subtitle">
              {skuCode} · {skuName}
            </p>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Số lô *</label>
            <input
              value={form.lot_number}
              onChange={(e) => setForm({ ...form, lot_number: e.target.value.toUpperCase() })}
              placeholder="LA001"
              required
              disabled={isEdit}
              autoFocus={!isEdit}
            />
            {!isEdit && (
              <small style={{ color: 'var(--gray-400)', fontSize: '0.75rem' }}>
                Nếu lô đã tồn tại, số lượng sẽ được cập nhật
              </small>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Ngày sản xuất (NSX)</label>
              <input
                type="date"
                value={form.manufacture_date}
                onChange={(e) => setForm({ ...form, manufacture_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Hạn sử dụng (HSD)</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Ảnh bằng chứng</label>
            {imgError && <div className="alert alert-error">{imgError}</div>}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.5rem',
              }}
            >
              {images.map((img) => (
                <div key={img.id} style={{ position: 'relative' }}>
                  <img
                    src={img.url}
                    alt="Ảnh lô"
                    title="Bấm để kiểm tra & chỉnh box"
                    onClick={() => setEditing({ kind: 'server', ref: img.id })}
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px solid var(--gray-200, #ddd)',
                      cursor: 'pointer',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleDeleteImage(img.id)}
                    aria-label="Xóa ảnh"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(220,38,38,0.95)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                      lineHeight: '20px',
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {pending.map((p, index) => (
                <div key={p.url} style={{ position: 'relative' }}>
                  <img
                    src={p.url}
                    alt="Ảnh chờ tải lên"
                    title="Bấm để kiểm tra & chỉnh box"
                    onClick={() => setEditing({ kind: 'pending', ref: index })}
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px dashed var(--primary, #2563eb)',
                      cursor: 'pointer',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePending(index)}
                    aria-label="Bỏ ảnh"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(220,38,38,0.95)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                      lineHeight: '20px',
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {images.length === 0 && pending.length === 0 && (
                <small style={{ color: 'var(--gray-400)', fontSize: '0.75rem' }}>
                  Chưa có ảnh nào
                </small>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCamera(true)}
                disabled={uploading || counting}
              >
                📷 Chụp hình
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || counting}
              >
                🖼️ Tải ảnh
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            {uploading && (
              <small style={{ color: 'var(--gray-400)', fontSize: '0.75rem' }}>
                Đang tải ảnh lên...
              </small>
            )}
            {countMsg && (
              <small
                style={{
                  display: 'block',
                  marginTop: '0.25rem',
                  color: counting ? 'var(--gray-400)' : 'var(--primary, #2563eb)',
                  fontSize: '0.75rem',
                }}
              >
                {countMsg}
              </small>
            )}
            {progress !== null && (
              <div
                aria-label="Tiến trình"
                style={{
                  marginTop: '0.35rem',
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--gray-200, #e5e7eb)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'var(--primary, #2563eb)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            )}
            {undoItem && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  marginTop: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 8,
                  background: 'var(--gray-100, #f3f4f6)',
                  fontSize: '0.8rem',
                }}
              >
                <span>🗑️ Đã xoá ảnh</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={undoDelete}>
                  ↩ Hoàn tác
                </button>
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Số lượng *</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
                required
                autoFocus={isEdit}
              />
            </div>
            <div className="form-group">
              <label>Chi nhánh</label>
              <input
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
                placeholder="HCM01"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Ghi chú</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Ghi chú thêm về lô hàng..."
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Hủy
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Lưu lô'}
            </button>
          </div>
        </form>
      </div>
    </div>

    {showCamera && (
      <CameraCaptureModal
        onCapture={(file) => {
          setShowCamera(false)
          void processFiles([file])
        }}
        onClose={() => setShowCamera(false)}
      />
    )}

    {reviewing && (
      <BoxReviewModal
        key={reviewIndex}
        src={reviewQueue[reviewIndex].url}
        initialBoxes={reviewQueue[reviewIndex].boxes}
        index={reviewIndex}
        total={reviewQueue.length}
        onConfirm={handleReviewConfirm}
        onCancel={handleReviewCancel}
      />
    )}

    {/* Mở lại một ảnh để chỉnh nhãn (ngoài luồng hàng đợi). */}
    {!reviewing && editing?.kind === 'pending' && pending[editing.ref] && (
      <BoxReviewModal
        key={`pending-${editing.ref}`}
        src={pending[editing.ref].url}
        initialBoxes={pending[editing.ref].boxes}
        index={0}
        total={1}
        onConfirm={(boxes, count) => handleEditPendingConfirm(editing.ref, boxes, count)}
        onCancel={() => setEditing(null)}
      />
    )}
    {!reviewing && editing?.kind === 'server' && (() => {
      const img = images.find((i) => i.id === editing.ref)
      if (!img) return null
      return (
        <BoxReviewModal
          key={`server-${editing.ref}`}
          src={img.url}
          initialBoxes={img.boxes ?? []}
          index={0}
          total={1}
          onConfirm={(boxes, count) => handleEditServerConfirm(editing.ref, boxes, count)}
          onCancel={() => setEditing(null)}
        />
      )
    })()}
    </>
  )
}
