import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DetBox } from '../types'
import { countBoxes } from '../api/client'
import { area, cleanupWithStats, interArea, normalize, OVERLAP_RATIO } from '../utils/boxes'
import type { CleanupStats } from '../utils/boxes'

interface Props {
  src: string // URL ảnh để hiển thị (object URL của file mới hoặc URL ảnh server)
  initialBoxes: DetBox[]
  index: number // vị trí ảnh trong hàng đợi (0-based)
  total: number // tổng số ảnh đang review
  onConfirm: (boxes: DetBox[], count: number) => void
  onCancel: () => void
}

// Box vẽ nhỏ hơn ngưỡng này (theo cạnh chuẩn hoá) bị bỏ qua — chống chạm nhầm.
const MIN_SIDE = 0.01
const ZOOM_MIN = 1
const ZOOM_MAX = 6

// ── Dò lại box theo vùng (double-click) ──────────────────────────────────
// Số box đã detect gần điểm click nhất dùng để suy ra kích thước box thật.
const NEIGHBORS_K = 3
// Khung crop = hệ số này × kích thước trung bình của box lân cận (đủ rộng để
// bao khoảng trống + vài box xung quanh làm ngữ cảnh cho model).
const CROP_MULTIPLIER = 3

type Mode = 'draw' | 'move' | 'pan'
type Corner = 'nw' | 'ne' | 'sw' | 'se'
type View = { zoom: number; x: number; y: number }

const CORNER_CURSOR: Record<Corner, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

export default function BoxReviewModal({ src, initialBoxes, index, total, onConfirm, onCancel }: Props) {
  // Dọn box lần đầu + giữ thống kê để báo cho người dùng số box bị lọc.
  const statsRef = useRef<CleanupStats | null>(null)
  if (!statsRef.current) statsRef.current = cleanupWithStats(initialBoxes)
  const [boxes, setBoxes] = useState<DetBox[]>(() => statsRef.current!.boxes)
  // Ref luôn giữ boxes hiện tại — tránh closure cũ trong undo/redo & phím tắt.
  const boxesRef = useRef(boxes)
  boxesRef.current = boxes
  // Lịch sử undo/redo: mỗi phần tử là một snapshot mảng boxes trước thao tác.
  const pastRef = useRef<DetBox[][]>([])
  const futureRef = useRef<DetBox[][]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Snapshot trước khi bắt đầu kéo/đổi kích thước (commit khi thả).
  const boxesBeforeRef = useRef<DetBox[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<DetBox | null>(null)
  // Chế độ thao tác: 'draw' = vẽ box mới; 'move' = chọn/di chuyển/đổi kích thước
  // box; 'pan' = kéo di chuyển ảnh (khi đã phóng to).
  const [mode, setMode] = useState<Mode>('draw')
  // Kích thước ảnh hiển thị cơ bản (px) khi zoom=1 — vừa khít khung.
  const [size, setSize] = useState({ w: 0, h: 0 })
  // Zoom + tịnh tiến (px) của lớp canvas chứa ảnh + svg.
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  // Đang gọi model dò lại vùng (double-click) — khoá thao tác, hiện spinner.
  const [detecting, setDetecting] = useState(false)
  // Thông báo ngắn ("Đã thêm N box", …) tự ẩn sau vài giây.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const drawingRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })
  // Kéo di chuyển box: box gốc + vị trí con trỏ (chuẩn hoá) lúc bấm.
  const dragRef = useRef<{ index: number; startX: number; startY: number; orig: DetBox } | null>(null)
  // Kéo góc đổi kích thước: box gốc + góc đang kéo.
  const resizeRef = useRef<{ index: number; corner: Corner; orig: DetBox } | null>(null)
  // Kéo di chuyển ảnh (pan): vị trí con trỏ + view lúc bấm.
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null)

  // Tính kích thước hiển thị sao cho cả modal vừa trong màn hình (modal bị chặn
  // ở max-height 90vh). Chừa chỗ cho padding modal + header + thanh công cụ +
  // phần đếm box + nút hành động (~330px) và bề rộng modal (~56px padding) để
  // không bao giờ phải cuộn dọc/ngang.
  const computeSize = () => {
    const el = imgRef.current
    if (!el || !el.naturalWidth || !el.naturalHeight) return
    const modalW = Math.min(1100, window.innerWidth * 0.95)
    const maxW = modalW - 56
    const maxH = window.innerHeight * 0.9 - 330
    const scale = Math.min(maxW / el.naturalWidth, maxH / el.naturalHeight)
    setSize({
      w: Math.max(1, Math.round(el.naturalWidth * scale)),
      h: Math.max(1, Math.round(el.naturalHeight * scale)),
    })
  }

  useLayoutEffect(() => {
    const onResize = () => computeSize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Kẹp tịnh tiến để ảnh luôn phủ kín khung (không để lộ khoảng trống).
  const clampView = (v: View, sz: { w: number; h: number }): View => {
    const minX = Math.min(0, sz.w - sz.w * v.zoom)
    const minY = Math.min(0, sz.h - sz.h * v.zoom)
    return {
      zoom: v.zoom,
      x: Math.min(0, Math.max(minX, v.x)),
      y: Math.min(0, Math.max(minY, v.y)),
    }
  }

  // Phóng to/thu nhỏ quanh vị trí con trỏ (clientX/Y), giữ điểm đó cố định.
  const applyZoom = (clientX: number, clientY: number, factor: number) => {
    const vp = viewportRef.current?.getBoundingClientRect()
    const sz = sizeRef.current
    if (!vp || !sz.w) return
    const cx = clientX - vp.left
    const cy = clientY - vp.top
    setView((v) => {
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * factor))
      if (nz === v.zoom) return v
      const bx = (cx - v.x) / v.zoom
      const by = (cy - v.y) / v.zoom
      return clampView({ zoom: nz, x: cx - bx * nz, y: cy - by * nz }, sz)
    })
  }

  const zoomByButton = (factor: number) => {
    const vp = viewportRef.current?.getBoundingClientRect()
    if (!vp) return
    applyZoom(vp.left + vp.width / 2, vp.top + vp.height / 2, factor)
  }
  const resetView = () => setView({ zoom: 1, x: 0, y: 0 })

  // Lăn chuột để zoom — dùng listener native (non-passive) để chặn cuộn trang.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyZoom(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Lấy toạ độ chuẩn hoá 0..1 từ con trỏ — dùng rect thực của ảnh nên tự đúng
  // kể cả khi đã zoom/pan.
  const toNorm = (clientX: number, clientY: number) => {
    const el = imgRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    const x = (clientX - r.left) / r.width
    const y = (clientY - r.top) / r.height
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  }

  // Hiện thông báo ngắn, tự ẩn sau 2.5s.
  const flash = (msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500)
  }
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current) }, [])

  // Khi mở: báo số box đã tự lọc (nhỏ / chồng) để người dùng không bất ngờ.
  useEffect(() => {
    const { removedSmall, removedOverlap, removedLowConf } = statsRef.current!
    const total = removedSmall + removedOverlap + removedLowConf
    if (total > 0) {
      const parts: string[] = []
      if (removedLowConf) parts.push(`${removedLowConf} tin cậy thấp`)
      if (removedSmall) parts.push(`${removedSmall} nhỏ`)
      if (removedOverlap) parts.push(`${removedOverlap} chồng`)
      flash(`Đã tự lọc ${total} box (${parts.join(', ')})`)
    }
  }, [])

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const syncHistoryFlags = () => {
    setCanUndo(pastRef.current.length > 0)
    setCanRedo(futureRef.current.length > 0)
  }
  // Ghi snapshot (trạng thái TRƯỚC thao tác) vào lịch sử, xoá nhánh redo.
  const pushHistory = (snapshot: DetBox[]) => {
    pastRef.current.push(snapshot)
    if (pastRef.current.length > 50) pastRef.current.shift()
    futureRef.current = []
    syncHistoryFlags()
  }
  const undo = () => {
    const prev = pastRef.current.pop()
    if (prev === undefined) return
    futureRef.current.push(boxesRef.current)
    setBoxes(prev)
    setSelected(null)
    syncHistoryFlags()
  }
  const redo = () => {
    const next = futureRef.current.pop()
    if (next === undefined) return
    pastRef.current.push(boxesRef.current)
    setBoxes(next)
    setSelected(null)
    syncHistoryFlags()
  }

  // Double-click vào một điểm (chuẩn hoá) → cắt vùng quanh đó (kích thước suy
  // từ box lân cận) và chạy lại model để bắt box bị bỏ sót, rồi gộp vào.
  const detectRegion = async (cx: number, cy: number) => {
    if (detecting) return
    const el = imgRef.current
    if (!el || !el.naturalWidth || !el.naturalHeight) return
    if (boxes.length === 0) {
      flash('Không có box lân cận để tham chiếu kích thước')
      return
    }
    // 1) k box gần điểm click nhất → kích thước trung bình.
    const near = boxes
      .map((b) => ({ b, d: Math.hypot((b.x1 + b.x2) / 2 - cx, (b.y1 + b.y2) / 2 - cy) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, NEIGHBORS_K)
    const avgW = near.reduce((s, o) => s + (o.b.x2 - o.b.x1), 0) / near.length
    const avgH = near.reduce((s, o) => s + (o.b.y2 - o.b.y1), 0) / near.length
    // 2) khung crop tâm tại điểm click, kẹp trong ảnh.
    const halfW = (avgW * CROP_MULTIPLIER) / 2
    const halfH = (avgH * CROP_MULTIPLIER) / 2
    const region = {
      x1: Math.max(0, cx - halfW),
      y1: Math.max(0, cy - halfH),
      x2: Math.min(1, cx + halfW),
      y2: Math.min(1, cy + halfH),
    }
    const rw = region.x2 - region.x1
    const rh = region.y2 - region.y1
    if (rw <= 0 || rh <= 0) return
    // 3) cắt vùng từ ảnh ở độ phân giải gốc.
    const nw = el.naturalWidth
    const nh = el.naturalHeight
    const sx = Math.round(region.x1 * nw)
    const sy = Math.round(region.y1 * nh)
    const sw = Math.max(1, Math.round(rw * nw))
    const sh = Math.max(1, Math.round(rh * nh))
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh)
    let blob: Blob | null
    try {
      // toBlob ném SecurityError đồng bộ nếu canvas bị "taint" (ảnh khác nguồn
      // không có CORS) — bắt để báo lỗi thay vì crash.
      blob = await new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95)
        } catch (err) {
          reject(err)
        }
      })
    } catch {
      flash('Không thể cắt vùng (ảnh khác nguồn, thiếu CORS)')
      return
    }
    if (!blob) return
    // 4) gửi crop lên model, ánh xạ box về ảnh đầy đủ, gộp box mới.
    setDetecting(true)
    try {
      const file = new File([blob], 'region.jpg', { type: 'image/jpeg' })
      const res = await countBoxes([file])
      const detected = res.per_image?.[0]?.boxes ?? []
      const mapped: DetBox[] = detected.map((d) => ({
        x1: region.x1 + d.x1 * rw,
        y1: region.y1 + d.y1 * rh,
        x2: region.x1 + d.x2 * rw,
        y2: region.y1 + d.y2 * rh,
        conf: d.conf,
      }))
      // Ứng viên hợp lệ về kích thước, chưa chồng > 0.25 diện tích box đã có.
      const candidates = mapped.filter(
        (m) =>
          m.x2 - m.x1 >= MIN_SIDE &&
          m.y2 - m.y1 >= MIN_SIDE &&
          boxes.every((b) => interArea(m, b) < OVERLAP_RATIO * Math.min(area(m), area(b))),
      )
      // Khử chồng lấn giữa chính các box mới (giữ box lớn hơn).
      const fresh: DetBox[] = []
      for (const m of [...candidates].sort((p, q) => area(q) - area(p))) {
        const overlaps = fresh.some(
          (k) => interArea(m, k) >= OVERLAP_RATIO * Math.min(area(m), area(k)),
        )
        if (!overlaps) fresh.push(m)
      }
      if (fresh.length) {
        pushHistory(boxesRef.current)
        setBoxes((prev) => [...prev, ...fresh])
        flash(`Đã thêm ${fresh.length} box`)
      } else {
        flash('Không tìm thấy box mới')
      }
    } catch {
      flash('Lỗi khi dò lại vùng')
    } finally {
      setDetecting(false)
    }
  }

  const onBgPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    if (mode === 'pan') {
      panRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y }
      return
    }
    setSelected(null)
    if (mode === 'draw') {
      const p = toNorm(e.clientX, e.clientY)
      startRef.current = p
      drawingRef.current = true
      setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    }
  }

  const onBoxPointerDown = (i: number, e: React.PointerEvent) => {
    if (mode !== 'move') return
    e.stopPropagation()
    setSelected(i)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toNorm(e.clientX, e.clientY)
    boxesBeforeRef.current = boxes // snapshot trước khi kéo
    dragRef.current = { index: i, startX: p.x, startY: p.y, orig: boxes[i] }
  }

  const onResizePointerDown = (corner: Corner, e: React.PointerEvent) => {
    if (selected === null) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    boxesBeforeRef.current = boxes // snapshot trước khi đổi kích thước
    resizeRef.current = { index: selected, corner, orig: boxes[selected] }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current
    if (pan) {
      setView((v) => clampView({ zoom: v.zoom, x: pan.vx + (e.clientX - pan.startX), y: pan.vy + (e.clientY - pan.startY) }, sizeRef.current))
      return
    }
    const rz = resizeRef.current
    if (rz) {
      const p = toNorm(e.clientX, e.clientY)
      const o = rz.orig
      let nb: DetBox
      switch (rz.corner) {
        case 'nw': nb = { x1: p.x, y1: p.y, x2: o.x2, y2: o.y2, conf: o.conf }; break
        case 'ne': nb = { x1: o.x1, y1: p.y, x2: p.x, y2: o.y2, conf: o.conf }; break
        case 'sw': nb = { x1: p.x, y1: o.y1, x2: o.x2, y2: p.y, conf: o.conf }; break
        default: nb = { x1: o.x1, y1: o.y1, x2: p.x, y2: p.y, conf: o.conf }; break
      }
      const norm = normalize(nb)
      setBoxes((prev) => prev.map((b, idx) => (idx === rz.index ? norm : b)))
      return
    }
    if (drawingRef.current) {
      const p = toNorm(e.clientX, e.clientY)
      setDraft({ x1: startRef.current.x, y1: startRef.current.y, x2: p.x, y2: p.y })
      return
    }
    const drag = dragRef.current
    if (drag) {
      const p = toNorm(e.clientX, e.clientY)
      const w = drag.orig.x2 - drag.orig.x1
      const h = drag.orig.y2 - drag.orig.y1
      const clamp = (val: number, max: number) => Math.min(max, Math.max(0, val))
      const nx1 = clamp(drag.orig.x1 + (p.x - drag.startX), 1 - w)
      const ny1 = clamp(drag.orig.y1 + (p.y - drag.startY), 1 - h)
      setBoxes((prev) =>
        prev.map((b, idx) => (idx === drag.index ? { x1: nx1, y1: ny1, x2: nx1 + w, y2: ny1 + h, conf: b.conf } : b)),
      )
    }
  }

  const onPointerUp = () => {
    panRef.current = null
    if (resizeRef.current) {
      resizeRef.current = null
      // Chỉ ghi lịch sử nếu box thực sự đổi (bỏ qua click không kéo).
      if (boxesBeforeRef.current && boxesBeforeRef.current !== boxesRef.current) {
        pushHistory(boxesBeforeRef.current)
      }
      boxesBeforeRef.current = null
      return
    }
    if (drawingRef.current) {
      drawingRef.current = false
      if (draft) {
        const b = normalize(draft)
        if (b.x2 - b.x1 >= MIN_SIDE && b.y2 - b.y1 >= MIN_SIDE) {
          pushHistory(boxesRef.current)
          setBoxes((prev) => [...prev, b])
        }
      }
      setDraft(null)
      return
    }
    if (dragRef.current) {
      dragRef.current = null
      // Chỉ ghi lịch sử nếu box thực sự đổi (bỏ qua click không kéo).
      if (boxesBeforeRef.current && boxesBeforeRef.current !== boxesRef.current) {
        pushHistory(boxesBeforeRef.current)
      }
      boxesBeforeRef.current = null
    }
  }

  const removeSelected = () => {
    if (selected === null) return
    pushHistory(boxesRef.current)
    setBoxes((prev) => prev.filter((_, i) => i !== selected))
    setSelected(null)
  }

  // Phím tắt: Delete/Backspace xoá box đang chọn; Esc bỏ chọn hoặc đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd+Z = undo; Ctrl/Cmd+Shift+Z hoặc Ctrl+Y = redo.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected !== null) {
          e.preventDefault()
          removeSelected()
        }
      } else if (e.key === 'Escape') {
        if (selected !== null) setSelected(null)
        else onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const switchMode = (m: Mode) => {
    setMode(m)
    if (m !== 'move') setSelected(null)
  }

  const px = (b: DetBox) => ({
    x: b.x1 * size.w,
    y: b.y1 * size.h,
    w: (b.x2 - b.x1) * size.w,
    h: (b.y2 - b.y1) * size.h,
  })

  // Kích thước hiển thị theo màn hình (không đổi khi zoom) cho viền & nút góc.
  const s = (v: number) => v / view.zoom

  // Màu viền/nền theo độ tin cậy (box conf ≤ 0.5 đã bị lọc bỏ ở cleanupWithStats):
  // box chọn = đỏ đậm; thủ công (không conf) = tím; 0.5<conf<0.6 = đỏ;
  // 0.6≤conf<0.7 = cam; conf≥0.7 = xanh — giúp ưu tiên box cần sửa.
  const boxColors = (b: DetBox, isSel: boolean) => {
    if (isSel) return { stroke: '#dc2626', fill: 'rgba(220,38,38,0.18)' }
    if (b.conf == null) return { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.12)' }
    if (b.conf < 0.6) return { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)' }
    if (b.conf < 0.7) return { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.14)' }
    return { stroke: '#2563eb', fill: 'rgba(37,99,235,0.12)' }
  }
  const confLabel = (b: DetBox | undefined) =>
    b == null ? '' : b.conf == null ? 'thủ công' : `${Math.round(b.conf * 100)}%`
  const cursor = mode === 'draw' ? 'crosshair' : mode === 'pan' ? (panRef.current ? 'grabbing' : 'grab') : 'default'

  const subtitle =
    mode === 'draw'
      ? 'Kéo để vẽ box mới (được phép bắt đầu bên trong box khác)'
      : mode === 'move'
        ? 'Bấm chọn box · kéo thân để di chuyển · kéo góc để đổi kích thước'
        : 'Kéo để di chuyển ảnh · lăn chuột hoặc nút +/− để phóng to'

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(1100px, 95vw)', width: '95vw' }}>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Đóng">✕</button>
        <div className="modal-header modal-header-icon">
          <span className="modal-icon">🔲</span>
          <div>
            <h2>Kiểm tra & chỉnh box</h2>
            <p className="modal-subtitle">Ảnh {index + 1}/{total} · {subtitle} · 💡 nhấp đúp vào chỗ trống để dò lại box</p>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className={`btn btn-sm ${mode === 'draw' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchMode('draw')}>
                ✏️ Vẽ box
              </button>
              <button type="button" className={`btn btn-sm ${mode === 'move' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchMode('move')}>
                ✋ Chọn / di chuyển
              </button>
              <button type="button" className={`btn btn-sm ${mode === 'pan' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => switchMode('pan')}>
                🖐 Kéo ảnh
              </button>
              <span style={{ width: 1, height: 20, background: 'var(--gray-300)', margin: '0 0.15rem' }} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={!canUndo} aria-label="Hoàn tác (Ctrl+Z)" title="Hoàn tác (Ctrl+Z)">↶</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={redo} disabled={!canRedo} aria-label="Làm lại (Ctrl+Shift+Z)" title="Làm lại (Ctrl+Shift+Z)">↷</button>
              <span style={{ width: 1, height: 20, background: 'var(--gray-300)', margin: '0 0.15rem' }} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => zoomByButton(1 / 1.25)} aria-label="Thu nhỏ">➖</button>
              <span style={{ fontSize: '0.8rem', minWidth: 44, textAlign: 'center', color: 'var(--gray-500)' }}>
                {Math.round(view.zoom * 100)}%
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => zoomByButton(1.25)} aria-label="Phóng to">➕</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={resetView} aria-label="Đặt lại">⟲</button>
            </div>
          </div>
        </div>

        <div
          ref={viewportRef}
          style={{
            position: 'relative',
            width: size.w || 'auto',
            height: size.h || 'auto',
            margin: '0 auto',
            overflow: 'hidden',
            borderRadius: 8,
            lineHeight: 0,
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: size.w || 'auto',
              height: size.h || 'auto',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <img
              ref={imgRef}
              src={src}
              alt="Ảnh kiểm đếm"
              onLoad={computeSize}
              width={size.w || undefined}
              height={size.h || undefined}
              style={{ display: 'block', borderRadius: 8 }}
              draggable={false}
            />
            <svg
              width={size.w}
              height={size.h}
              style={{ position: 'absolute', top: 0, left: 0, cursor }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* Lớp nền bắt thao tác vẽ box / kéo ảnh / bỏ chọn.
                  Nhấp đúp → dò lại box quanh điểm đó bằng model. */}
              <rect
                x={0}
                y={0}
                width={size.w}
                height={size.h}
                fill="transparent"
                onPointerDown={onBgPointerDown}
                onDoubleClick={(e) => {
                  const p = toNorm(e.clientX, e.clientY)
                  detectRegion(p.x, p.y)
                }}
              />
              {boxes.map((b, i) => {
                const r = px(b)
                const isSel = i === selected
                const c = boxColors(b, isSel)
                return (
                  <rect
                    key={i}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={c.fill}
                    stroke={c.stroke}
                    strokeWidth={s(2)}
                    style={{ cursor: mode === 'move' ? 'move' : 'inherit', pointerEvents: mode === 'move' ? 'auto' : 'none' }}
                    onPointerDown={(e) => onBoxPointerDown(i, e)}
                  />
                )
              })}
              {/* Box đang vẽ. */}
              {draft && (() => {
                const r = px(normalize(draft))
                return (
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={s(2)} strokeDasharray={`${s(4)} ${s(3)}`} pointerEvents="none" />
                )
              })()}
              {/* Nút 4 góc để đổi kích thước box đang chọn (chế độ di chuyển). */}
              {mode === 'move' && selected !== null && boxes[selected] && (() => {
                const r = px(boxes[selected])
                const hs = s(5)
                const corners: { c: Corner; x: number; y: number }[] = [
                  { c: 'nw', x: r.x, y: r.y },
                  { c: 'ne', x: r.x + r.w, y: r.y },
                  { c: 'sw', x: r.x, y: r.y + r.h },
                  { c: 'se', x: r.x + r.w, y: r.y + r.h },
                ]
                return corners.map((k) => (
                  <rect
                    key={k.c}
                    x={k.x - hs}
                    y={k.y - hs}
                    width={hs * 2}
                    height={hs * 2}
                    fill="#fff"
                    stroke="#dc2626"
                    strokeWidth={s(1.5)}
                    style={{ cursor: CORNER_CURSOR[k.c] }}
                    onPointerDown={(e) => onResizePointerDown(k.c, e)}
                  />
                ))
              })()}
              {/* Nút ✕ xoá box đang chọn — đặt lệch ra ngoài góc trên-phải để
                  không đè lên nút đổi kích thước. */}
              {mode === 'move' && selected !== null && boxes[selected] && (() => {
                const r = px(boxes[selected])
                return (
                  <g
                    transform={`translate(${r.x + r.w + s(13)}, ${r.y - s(13)})`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      removeSelected()
                    }}
                  >
                    <circle cx={0} cy={0} r={s(11)} fill="#dc2626" />
                    <text x={0} y={s(1)} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={s(14)}>✕</text>
                  </g>
                )
              })()}
            </svg>
          </div>
          {/* Overlay khoá thao tác khi đang dò lại vùng (không scale theo zoom). */}
          {detecting && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.25)',
                zIndex: 5,
              }}
            >
              <div style={{ background: '#fff', padding: '0.5rem 0.9rem', borderRadius: 8, fontSize: '0.85rem', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                ⏳ Đang dò lại vùng…
              </div>
            </div>
          )}
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
            {selected !== null && boxes[selected] && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.85rem', fontWeight: 400, color: 'var(--gray-500)' }}>
                · Độ tin cậy: {confLabel(boxes[selected])}
              </span>
            )}
            {notice && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.85rem', fontWeight: 400, color: 'var(--gray-500)' }}>
                {notice}
              </span>
            )}
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
