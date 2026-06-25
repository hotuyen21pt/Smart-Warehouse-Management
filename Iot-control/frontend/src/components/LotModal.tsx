import { useState } from 'react'
import { upsertLot, updateLot } from '../api/client'
import type { Lot } from '../types'

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
        await upsertLot({
          sku_id: skuId,
          lot_number: form.lot_number,
          manufacture_date: form.manufacture_date,
          expiry_date: form.expiry_date,
          qty: Number(form.qty),
          branch: form.branch,
          notes: form.notes,
        })
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
        <div className="modal-header">
          <h2>{isEdit ? 'Cập nhật lô' : 'Thêm / Cập nhật lô'}</h2>
          <p className="modal-subtitle">
            {skuCode} · {skuName}
          </p>
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
              <label>Ngày sản xuất</label>
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
