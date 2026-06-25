import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getSKU, deleteLot } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { SKU, Lot } from '../types'
import LotModal from '../components/LotModal'
import ThemeToggle from '../components/ThemeToggle'
import HeaderMenu from '../components/HeaderMenu'

export default function SKUDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [sku, setSKU] = useState<SKU | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingLot, setEditingLot] = useState<Lot | null>(null)
  const [showAddLot, setShowAddLot] = useState(false)
  // Bộ lọc lô: theo số lô (text) và khoảng "Thời gian kiểm".
  const [lotQuery, setLotQuery] = useState('')
  const [lotFrom, setLotFrom] = useState('')
  const [lotTo, setLotTo] = useState('')
  const { user } = useAuth()
  const navigate = useNavigate()

  const fetchSKU = useCallback(async () => {
    if (!id) return
    try {
      const data = await getSKU(Number(id))
      setSKU(data)
    } catch {
      navigate('/')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { fetchSKU() }, [fetchSKU])

  const handleDeleteLot = async (lotId: number) => {
    if (!confirm('Xóa lô này?')) return
    await deleteLot(lotId)
    fetchSKU()
  }

  const handleLotSaved = () => {
    setShowAddLot(false)
    setEditingLot(null)
    fetchSKU()
  }

  if (loading) return <div className="loading-screen">Đang tải...</div>
  if (!sku) return null

  // Lọc client-side trên dữ liệu lô đã tải sẵn.
  const lots = sku.lots ?? []
  const filteredLots = lots.filter((lot) => {
    if (lotQuery && !lot.lot_number.toLowerCase().includes(lotQuery.toLowerCase())) return false
    if (lotFrom || lotTo) {
      const t = lot.counted_at ? new Date(lot.counted_at).getTime() : 0
      if (lotFrom && t < new Date(lotFrom).getTime()) return false
      if (lotTo && t > new Date(lotTo).getTime()) return false
    }
    return true
  })
  const filteredTotal = filteredLots.reduce((sum, l) => sum + l.qty, 0)
  const hasLotFilter = !!(lotQuery || lotFrom || lotTo)

  return (
    <div className="page">
      <header className="header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
          ← Quay lại
        </button>

        <div className="header-center">
          <h1>{sku.sku_code}</h1>
          <p className="header-subtitle">{sku.name}</p>
        </div>

        <div className="header-right">
          <ThemeToggle />
          <HeaderMenu>
            <div className="user-badge">
              <span>{user?.full_name}</span>
              <span className="branch-tag">{user?.branch}</span>
            </div>
          </HeaderMenu>
        </div>
      </header>

      <main className="main">
        {/* Summary cards */}
        <div className="sku-summary">
          <div className="summary-card">
            <div className="summary-label">Tổng số lượng</div>
            <div className="summary-value">
              {sku.total_qty.toLocaleString('vi-VN')}
              <span className="unit">{sku.unit}</span>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Số lô đang kiểm</div>
            <div className="summary-value">{sku.lot_count}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Đơn vị tính</div>
            <div className="summary-value" style={{ fontSize: '1.25rem' }}>{sku.unit}</div>
          </div>
        </div>

        {/* Lot list */}
        <div className="section-header">
          <h2>Danh sách số lô</h2>
          <button className="btn btn-primary" onClick={() => setShowAddLot(true)}>
            + Thêm / Cập nhật lô
          </button>
        </div>

        {!lots.length ? (
          <div className="empty-state">
            <span className="empty-icon">🗂️</span>
            <p>Chưa có lô nào. Bấm "Thêm / Cập nhật lô" để bắt đầu kiểm đếm.</p>
          </div>
        ) : (
          <>
            <div className="filter-bar">
              <input
                className="filter-text"
                type="text"
                placeholder="🔍 Tìm số lô..."
                value={lotQuery}
                onChange={(e) => setLotQuery(e.target.value)}
              />
              <span className="filter-label">📅 Kiểm:</span>
              <input type="datetime-local" step="1" value={lotFrom} onChange={(e) => setLotFrom(e.target.value)} aria-label="Từ thời điểm" />
              <span className="filter-sep">→</span>
              <input type="datetime-local" step="1" value={lotTo} onChange={(e) => setLotTo(e.target.value)} aria-label="Đến thời điểm" />
              {hasLotFilter && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setLotQuery(''); setLotFrom(''); setLotTo('') }}
                >
                  Xóa lọc
                </button>
              )}
              <span className="filter-count">{filteredLots.length}/{lots.length} lô</span>
            </div>

            {!filteredLots.length ? (
              <div className="empty-state">
                <span className="empty-icon">🔍</span>
                <p>Không có lô nào khớp bộ lọc.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="lot-table">
                  <thead>
                <tr>
                  <th>Số lô</th>
                  <th>Ngày SX</th>
                  <th>HSD</th>
                  <th>Số lượng</th>
                  <th>Chi nhánh</th>
                  <th>Người kiểm</th>
                  <th>Thời gian kiểm</th>
                  <th>Ghi chú</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot) => (
                  <tr key={lot.id}>
                    <td className="lot-number-cell" data-label="Số lô">{lot.lot_number}</td>
                    <td data-label="Ngày SX">{lot.manufacture_date || <span className="text-muted">—</span>}</td>
                    <td data-label="HSD">{lot.expiry_date || <span className="text-muted">—</span>}</td>
                    <td className="qty-cell" data-label="Số lượng">
                      {lot.qty.toLocaleString('vi-VN')} {sku.unit}
                    </td>
                    <td data-label="Chi nhánh">{lot.branch || <span className="text-muted">—</span>}</td>
                    <td data-label="Người kiểm">{lot.counted_by_name || <span className="text-muted">—</span>}</td>
                    <td data-label="Thời gian kiểm">
                      {new Date(lot.counted_at).toLocaleString('vi-VN', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </td>
                    <td data-label="Ghi chú">{lot.notes || <span className="text-muted">—</span>}</td>
                    <td className="actions-cell">
                      <div className="action-buttons">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingLot(lot)}>
                          Sửa
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteLot(lot.id)}>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 600 }}>
                    {hasLotFilter ? 'Tổng (đã lọc)' : 'Tổng cộng'}
                  </td>
                  <td className="qty-cell" style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {filteredTotal.toLocaleString('vi-VN')} {sku.unit}
                  </td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {(showAddLot || editingLot) && (
        <LotModal
          skuId={sku.id}
          skuCode={sku.sku_code}
          skuName={sku.name}
          lot={editingLot ?? undefined}
          userBranch={user?.branch ?? ''}
          onSave={handleLotSaved}
          onClose={() => { setShowAddLot(false); setEditingLot(null) }}
        />
      )}
    </div>
  )
}
