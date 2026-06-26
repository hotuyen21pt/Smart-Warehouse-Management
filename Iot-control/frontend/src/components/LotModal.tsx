import { useEffect, useRef, useState } from 'react'
import {
  upsertLot,
  updateLot,
  listLotImages,
  uploadLotImages,
  deleteLotImage,
  countBoxes,
} from '../api/client'
import type { Lot, LotImage } from '../types'

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
  // Ảnh chọn tạm khi tạo lô mới (chưa có lot.id) — sẽ upload sau khi tạo.
  // count: số box đếm được trên ảnh, để khi bỏ ảnh thì trừ lại khỏi Số lượng.
  const [pending, setPending] = useState<{ file: File; url: string; count: number }[]>([])
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState('')
  // Trạng thái đếm box tự động.
  const [counting, setCounting] = useState(false)
  const [countMsg, setCountMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Giải phóng các object URL còn lại khi đóng modal.
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  useEffect(() => {
    if (!isEdit || !lot?.id) return
    listLotImages(lot.id)
      .then(setImages)
      .catch(() => setImgError('Không tải được danh sách ảnh'))
  }, [isEdit, lot?.id])

  const resetInputs = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  // runCount gọi dịch vụ đếm box, CỘNG DỒN tổng vào ô Số lượng,
  // và trả về số box của TỪNG ảnh (theo đúng thứ tự files) để lưu kèm ảnh.
  const runCount = async (files: File[]): Promise<number[]> => {
    setCounting(true)
    setCountMsg('Đang đếm box…')
    try {
      const res = await countBoxes(files)
      setForm((prev) => ({ ...prev, qty: Number(prev.qty || 0) + res.total }))
      setCountMsg(`Đã đếm: +${res.total} box`)
      return files.map((_, i) => res.per_image?.[i]?.count ?? 0)
    } catch (err: any) {
      setCountMsg('')
      setImgError(err?.response?.data?.error || 'Đếm box thất bại')
      return files.map(() => 0)
    } finally {
      setCounting(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) {
      resetInputs()
      return
    }
    setImgError('')
    resetInputs()

    // Đếm trước để biết số box từng ảnh (đồng thời cộng tổng vào Số lượng).
    const counts = await runCount(files)

    if (!isEdit || !lot?.id) {
      // Tạo lô mới: chưa có lot.id, giữ ảnh kèm count trong bộ nhớ để upload sau khi lưu.
      setPending((prev) => [
        ...prev,
        ...files.map((f, i) => ({ file: f, url: URL.createObjectURL(f), count: counts[i] ?? 0 })),
      ])
    } else {
      // Sửa lô: upload ngay lên server kèm count từng ảnh.
      setUploading(true)
      try {
        const created = await uploadLotImages(lot.id, files, counts)
        setImages((prev) => [...prev, ...created])
      } catch (err: any) {
        setImgError(err?.response?.data?.error || 'Tải ảnh thất bại')
      } finally {
        setUploading(false)
      }
    }
  }

  const handleRemovePending = (index: number) => {
    const removed = pending[index]
    if (!removed) return
    URL.revokeObjectURL(removed.url)
    setPending((prev) => prev.filter((_, i) => i !== index))
    // Bỏ ảnh tạm thì trừ lại số box của ảnh đó khỏi Số lượng.
    setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) - (removed.count || 0)) }))
  }

  const handleDeleteImage = async (imageId: number) => {
    if (!lot?.id) return
    setImgError('')
    const target = images.find((img) => img.id === imageId)
    try {
      await deleteLotImage(lot.id, imageId)
      setImages((prev) => prev.filter((img) => img.id !== imageId))
      // Xóa ảnh thì trừ lại số box của ảnh đó khỏi Số lượng.
      if (target) {
        setForm((f) => ({ ...f, qty: Math.max(0, Number(f.qty || 0) - (target.count || 0)) }))
      }
    } catch (err: any) {
      setImgError(err?.response?.data?.error || 'Xóa ảnh thất bại')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isEdit) {
        await updateLot(lot.id, {
          manufacture_date: form.manufacture_date,
          expiry_date: form.expiry_date,
          qty: Number(form.qty),
          notes: form.notes,
        })
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
        // Upload các ảnh đã chọn tạm sau khi lô được tạo.
        if (pending.length > 0 && newLot?.id) {
          try {
            await uploadLotImages(newLot.id, pending.map((p) => p.file), pending.map((p) => p.count))
          } catch {
            setImgError('Lô đã được lưu nhưng tải ảnh thất bại')
          }
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

  return (
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
                  <a href={img.url} target="_blank" rel="noreferrer">
                    <img
                      src={img.url}
                      alt="Ảnh lô"
                      style={{
                        width: 120,
                        height: 120,
                        objectFit: 'cover',
                        borderRadius: 8,
                        border: '1px solid var(--gray-200, #ddd)',
                      }}
                    />
                  </a>
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
                    style={{
                      width: 120,
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px dashed var(--primary, #2563eb)',
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
                onClick={() => cameraInputRef.current?.click()}
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
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleUpload}
              disabled={uploading}
              style={{ display: 'none' }}
            />
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
  )
}
