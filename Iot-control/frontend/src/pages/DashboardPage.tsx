import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listSKUs, createSKU, deleteSKU } from '../api/client'
import type { SKU } from '../types'

import ThemeToggle from '../components/ThemeToggle'
import HeaderMenu from '../components/HeaderMenu'

// Lazy-load để html5-qrcode chỉ tải khi nhân viên mở scanner.
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

// Đơn vị tính thường dùng — cho phép chọn nhanh khi tạo SKU.
const COMMON_UNITS = ['cái', 'hộp', 'chai', 'vỉ', 'lốc', 'tuýp', 'thùng']

const cameraSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export default function DashboardPage() {
  const [skus, setSKUs] = useState<SKU[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [scanTarget, setScanTarget] = useState<'search' | 'create' | null>(null)
  const [newSKU, setNewSKU] = useState({ sku_code: '', name: '', unit: 'cái' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const fetchSKUs = useCallback(async () => {
    try {
      const data = await listSKUs(query || undefined)
      setSKUs(data)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = setTimeout(fetchSKUs, 300)
    return () => clearTimeout(timer)
  }, [fetchSKUs])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      await createSKU(newSKU)
      setNewSKU({ sku_code: '', name: '', unit: 'cái' })
      setShowCreate(false)
      fetchSKUs()
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || 'Không thể tạo SKU')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Xóa SKU này và tất cả lô liên quan?')) return
    await deleteSKU(id)
    fetchSKUs()
  }

  return (
    <div className="page">
      <header className="header">
        <Link to="/" className="header-brand">
          <span>📦</span> Kiểm Soát Số Lô
        </Link>

        <div className="header-right">
          <ThemeToggle />
          <HeaderMenu>
            {user?.role === 'admin' && (
              <Link to="/users" className="btn btn-ghost btn-sm">
                Tài khoản
              </Link>
            )}
            <div className="user-badge">
              <span>{user?.full_name}</span>
              <span className="branch-tag">{user?.branch}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              Đăng xuất
            </button>
          </HeaderMenu>
        </div>
      </header>

      <main className="main">
        <div className="toolbar">
          <input
            className="search-input"
            type="text"
            placeholder="🔍  Tìm theo mã SKU hoặc tên sản phẩm..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {cameraSupported && (
            <button
              className="btn btn-ghost"
              title="Quét barcode / QR"
              onClick={() => setScanTarget('search')}
            >
              📷 Quét
            </button>
          )}
          {user?.role === 'admin' && (
            <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateError('') }}>
              + Thêm SKU
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading">Đang tải danh sách SKU...</div>
        ) : skus.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <p>{query ? `Không tìm thấy SKU nào cho "${query}"` : 'Chưa có SKU nào trong hệ thống'}</p>
          </div>
        ) : (
          <div className="sku-grid">
            {skus.map((sku) => (
              <div key={sku.id} className="sku-card" onClick={() => navigate(`/skus/${sku.id}`)}>
                <div className="sku-code">{sku.sku_code}</div>
                <div className="sku-name">{sku.name}</div>
                <div className="sku-stats">
                  <div className="stat">
                    <span className="stat-label">Tổng SL</span>
                    <span className="stat-value">
                      {sku.total_qty.toLocaleString('vi-VN')} {sku.unit}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Số lô</span>
                    <span className="stat-value">{sku.lot_count}</span>
                  </div>
                </div>
                {user?.role === 'admin' && (
                  <div className="sku-card-actions">
                    <button className="btn btn-danger btn-sm" onClick={(e) => handleDelete(sku.id, e)}>
                      Xóa
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {scanTarget && (
        <Suspense fallback={null}>
          <BarcodeScannerModal
            onScan={(code) => {
              if (scanTarget === 'search') {
                setQuery(code)
              } else {
                setNewSKU((prev) => ({ ...prev, sku_code: code }))
              }
              setScanTarget(null)
            }}
            onClose={() => setScanTarget(null)}
          />
        </Suspense>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header modal-header-icon">
              <span className="modal-icon">📦</span>
              <div>
                <h2>Thêm SKU mới</h2>
                <p className="modal-subtitle">Quét barcode/QR hoặc nhập tay, rồi điền thông tin sản phẩm</p>
              </div>
            </div>
            {createError && <div className="alert alert-error">{createError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Mã SKU *</label>
                <div className="input-row">
                  <input
                    value={newSKU.sku_code}
                    onChange={(e) => setNewSKU({ ...newSKU, sku_code: e.target.value })}
                    placeholder="422493107"
                    required
                    autoFocus
                  />
                  {cameraSupported && (
                    <button
                      type="button"
                      className="btn btn-primary btn-scan"
                      title="Quét barcode / QR"
                      onClick={() => setScanTarget('create')}
                    >
                      📷 Quét
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Tên sản phẩm *</label>
                <input
                  value={newSKU.name}
                  onChange={(e) => setNewSKU({ ...newSKU, name: e.target.value })}
                  placeholder="VD: Sữa rửa mặt Cetaphil 500ml"
                  required
                />
              </div>
              <div className="form-group">
                <label>Đơn vị tính</label>
                <div className="chip-row">
                  {COMMON_UNITS.map((u) => (
                    <button
                      type="button"
                      key={u}
                      className={`chip ${newSKU.unit === u ? 'chip-active' : ''}`}
                      onClick={() => setNewSKU({ ...newSKU, unit: u })}
                    >
                      {u}
                    </button>
                  ))}
                </div>
                <input
                  value={newSKU.unit}
                  onChange={(e) => setNewSKU({ ...newSKU, unit: e.target.value })}
                  placeholder="hoặc nhập đơn vị khác..."
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Đang tạo...' : 'Tạo SKU'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
