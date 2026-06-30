import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DetBox } from '../types'

interface Props {
  file: File
  initialBoxes: DetBox[]
  index: number // vị trí ảnh trong hàng đợi (0-based)
  total: number // tổng số ảnh đang review
  onConfirm: (boxes: DetBox[], count: number) => void
  onCancel: () => void
}

// Chuẩn hoá box để x1<x2, y1<y2 (sau khi kéo có thể ngược chiều).
const normalize = (b: DetBox): DetBox => ({
  x1: Math.min(b.x1, b.x2),
  y1: Math.min(b.y1, b.y2),
  x2: Math.max(b.x1, b.x2),
  y2: Math.max(b.y1, b.y2),
  conf: b.conf,
})

// Box vẽ nhỏ hơn ngưỡng này (theo cạnh chuẩn hoá) bị bỏ qua — chống chạm nhầm.
const MIN_SIDE = 0.01

export default function BoxReviewModal({ file, initialBoxes, index, total, onConfirm, onCancel }: Props) {
  const [boxes, setBoxes] = useState<DetBox[]>(() => initialBoxes.map(normalize))
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<DetBox | null>(null)
  // Kích thước ảnh hiển thị thực (px) để quy đổi toạ độ chuẩn hoá ↔ pixel.
  const [size, setSize] = useState({ w: 0, h: 0 })

  const url = useRef<string>('')
  if (!url.current) url.current = URL.createObjectURL(file)
  useEffect(() => () => URL.revokeObjectURL(url.current), [])

  const imgRef = useRef<HTMLImageElement>(null)
  const drawingRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })

  // Đo kích thước ảnh hiển thị; cập nhật khi load và khi đổi kích thước cửa sổ.
  useLayoutEffect(() => {
    const measure = () => {
      const el = imgRef.current
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (imgRef.current) ro.observe(imgRef.current)
    return () => ro.disconnect()
  }, [])

  // Lấy toạ độ chuẩn hoá 0..1 từ vị trí con trỏ trên ảnh.
  const toNorm = (clientX: number, clientY: number) => {
    const el = imgRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    const x = (clientX - r.left) / r.width
    const y = (clientY - r.top) / r.height
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }

  const onPointerDownBg = (e: React.PointerEvent) => {
    // Bắt đầu vẽ box mới trên vùng trống.
    setSelected(null)
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toNorm(e.clientX, e.clientY)
    startRef.current = p
    drawingRef.current = true
    setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    const p = toNorm(e.clientX, e.clientY)
    setDraft({ x1: startRef.current.x, y1: startRef.current.y, x2: p.x, y2: p.y })
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (draft) {
      const b = normalize(draft)
      if (b.x2 - b.x1 >= MIN_SIDE && b.y2 - b.y1 >= MIN_SIDE) {
        setBoxes((prev) => [...prev, b])
      }
    }
    setDraft(null)
  }

  const removeSelected = () => {
    if (selected === null) return
    setBoxes((prev) => prev.filter((_, i) => i !== selected))
    setSelected(null)
  }

  const px = (b: DetBox) => ({
    x: b.x1 * size.w,
    y: b.y1 * size.h,
    w: (b.x2 - b.x1) * size.w,
    h: (b.y2 - b.y1) * size.h,
  })

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(1100px, 95vw)', width: '95vw' }}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Đóng">✕</button>
        <div className="modal-header modal-header-icon">
          <span className="modal-icon">🔲</span>
          <div>
            <h2>Kiểm tra & chỉnh box</h2>
            <p className="modal-subtitle">
              Ảnh {index + 1}/{total} · Kéo để vẽ thêm box · Bấm box để chọn rồi xoá
            </p>
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            margin: '0 auto',
            lineHeight: 0,
            userSelect: 'none',
          }}
        >
          <img
            ref={imgRef}
            src={url.current}
            alt="Ảnh kiểm đếm"
            onLoad={() => {
              const el = imgRef.current
              if (el) setSize({ w: el.clientWidth, h: el.clientHeight })
            }}
            style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block', borderRadius: 8 }}
            draggable={false}
          />
          <svg
            width={size.w}
            height={size.h}
            style={{ position: 'absolute', top: 0, left: 0, touchAction: 'none', cursor: 'crosshair' }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* Lớp nền bắt thao tác vẽ box mới. */}
            <rect
              x={0}
              y={0}
              width={size.w}
              height={size.h}
              fill="transparent"
              onPointerDown={onPointerDownBg}
            />
            {boxes.map((b, i) => {
              const r = px(b)
              const isSel = i === selected
              return (
                <rect
                  key={i}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill={isSel ? 'rgba(220,38,38,0.18)' : 'rgba(37,99,235,0.12)'}
                  stroke={isSel ? '#dc2626' : '#2563eb'}
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setSelected(i)
                  }}
                />
              )
            })}
            {/* Box đang vẽ. */}
            {draft && (() => {
              const r = px(normalize(draft))
              return (
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill="rgba(16,185,129,0.15)"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )
            })()}
            {/* Nút xoá ở góc box đang chọn. */}
            {selected !== null && boxes[selected] && (() => {
              const r = px(boxes[selected])
              return (
                <g
                  transform={`translate(${r.x + r.w}, ${r.y})`}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    removeSelected()
                  }}
                >
                  <circle cx={0} cy={0} r={11} fill="#dc2626" />
                  <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={14}>✕</text>
                </g>
              )
            })()}
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '0.75rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <strong style={{ fontSize: '1rem' }}>
            Số box: <span style={{ color: 'var(--primary, #2563eb)' }}>{boxes.length}</span>
          </strong>
          {selected !== null && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeSelected}>
              🗑️ Xoá box đã chọn
            </button>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Bỏ qua ảnh này
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(boxes, boxes.length)}>
            {index + 1 < total ? 'Xác nhận · Ảnh tiếp →' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  )
}
