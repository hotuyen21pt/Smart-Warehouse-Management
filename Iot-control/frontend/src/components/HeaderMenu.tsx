import { useState, useRef, useEffect } from 'react'

/**
 * Gom các mục phụ của header (Tài khoản, tên user, Đăng xuất...).
 * - Desktop: hiển thị inline như cũ.
 * - Mobile (≤768px): thu lại sau nút ☰, bấm để mở panel đổ xuống.
 * Tự đóng khi chọn một mục hoặc chạm ra ngoài.
 */
export default function HeaderMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="header-menu" ref={ref} data-open={open}>
      <button
        type="button"
        className="header-menu__toggle"
        aria-label="Mở menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>
      <div className="header-menu__items" onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  )
}
