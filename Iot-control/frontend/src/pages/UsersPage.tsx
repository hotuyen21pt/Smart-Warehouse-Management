import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { listUsers, createUser, deleteUser } from '../api/client'
import type { User } from '../types'
import ThemeToggle from '../components/ThemeToggle'
import HeaderMenu from '../components/HeaderMenu'

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', full_name: '', branch: '', role: 'staff' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const { user: me } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (me?.role !== 'admin') { navigate('/'); return }
    listUsers().then(setUsers).finally(() => setLoading(false))
  }, [me, navigate])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const u = await createUser(form)
      setUsers((prev) => [...prev, u])
      setForm({ username: '', password: '', full_name: '', branch: '', role: 'staff' })
      setShowCreate(false)
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || 'Không thể tạo tài khoản')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Xóa tài khoản này?')) return
    await deleteUser(id)
    setUsers((prev) => prev.filter((u) => u.id !== id))
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
            <div className="user-badge">
              <span>{me?.full_name}</span>
              <span className="branch-tag">{me?.branch}</span>
            </div>
          </HeaderMenu>
        </div>
      </header>

      <main className="main">
        <div className="section-header">
          <h2>Quản lý tài khoản</h2>
          <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateError('') }}>
            + Thêm tài khoản
          </button>
        </div>

        {loading ? (
          <div className="loading">Đang tải...</div>
        ) : (
          <div className="user-list">
            {users.map((u) => (
              <div key={u.id} className="user-item">
                <div className="user-info-row">
                  <span className="user-name">{u.full_name}</span>
                  <span className="user-meta">
                    @{u.username} · Chi nhánh: <strong>{u.branch}</strong>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`role-badge ${u.role}`}>{u.role === 'admin' ? 'Admin' : 'Nhân viên'}</span>
                  {u.role !== 'admin' && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)}>
                      Xóa
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Thêm tài khoản</h2>
              <p className="modal-subtitle">Tạo tài khoản cho nhân viên chi nhánh</p>
            </div>
            {createError && <div className="alert alert-error">{createError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-row">
                <div className="form-group">
                  <label>Tên đăng nhập *</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoFocus />
                </div>
                <div className="form-group">
                  <label>Mật khẩu *</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </div>
              </div>
              <div className="form-group">
                <label>Họ tên *</label>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Chi nhánh *</label>
                  <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="HCM01, HN02..." required />
                </div>
                <div className="form-group">
                  <label>Vai trò</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="staff">Nhân viên</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Đang tạo...' : 'Tạo tài khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
