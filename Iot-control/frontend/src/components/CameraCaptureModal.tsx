import { useEffect, useRef, useState } from 'react'
import { countBoxes } from '../api/client'
import type { DetBox } from '../types'
import { cleanupDetections } from '../utils/boxes'

interface Props {
  onCapture: (file: File) => void // trả về ảnh vừa chụp để nhận diện + review
  onClose: () => void
}

// ─── Tham số nhận diện live + làm mượt ───────────────────────────────
// Khung gửi để nhận diện live: khớp imgsz=960 của model (như upload full-res,
// vì YOLO cũng thu ảnh upload về 960 trước khi detect) -> số box + conf lúc
// ngắm sát với lúc chụp full-res. Gửi lớn hơn 960 chỉ tốn băng thông.
const LIVE_MAX_DIM = 960
const LIVE_QUALITY = 0.85
const SEND_GAP = 250 // ms nghỉ giữa các lần gửi (throttle ~3-4 fps)
const DIFF_THRESHOLD = 6 // ngưỡng đổi khung (0..255) để quyết định gửi
const MATCH_DIST = 0.08 // khoảng cách tâm tối đa (chuẩn hoá) để coi là cùng box
const EASE = 0.28 // hệ số tiến tới vị trí mới mỗi khung animation
const MAX_MISSED = 3 // số nhịp liên tiếp không thấy trước khi xoá box

type Box = { x1: number; y1: number; x2: number; y2: number }
type Track = { id: number; cur: Box; target: Box; missed: number }

const cx = (b: Box) => (b.x1 + b.x2) / 2
const cy = (b: Box) => (b.y1 + b.y2) / 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x1: lerp(a.x1, b.x1, t),
  y1: lerp(a.y1, b.y1, t),
  x2: lerp(a.x2, b.x2, t),
  y2: lerp(a.y2, b.y2, t),
})

/**
 * Chụp ảnh bằng camera điện thoại ngay trong app (getUserMedia, camera sau),
 * kèm NHẬN DIỆN LIVE + làm mượt: định kỳ gửi khung hình (thu nhỏ) tới dịch vụ
 * đếm box, khớp box mới với box cũ rồi nội suy vị trí để nhìn mượt, và chỉ gửi
 * khi khung thay đổi đáng kể để đỡ tải server.
 * Yêu cầu HTTPS hoặc localhost để trình duyệt cho phép truy cập camera.
 */
export default function CameraCaptureModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  // Box hiển thị (đã làm mượt), chuẩn hoá 0..1.
  const [displayBoxes, setDisplayBoxes] = useState<Box[]>([])

  const tracksRef = useRef<Track[]>([])
  const nextIdRef = useRef(1)
  const prevSampleRef = useRef<Uint8ClampedArray | null>(null)
  const lastCountRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt không hỗ trợ camera. Hãy dùng HTTPS hoặc nút "Tải ảnh".')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setReady(true)
      })
      .catch((err: { name?: string }) => {
        const name = err?.name || ''
        if (name === 'NotAllowedError') {
          setError('Bạn đã từ chối quyền camera. Vui lòng cấp quyền hoặc dùng nút "Tải ảnh".')
        } else if (name === 'NotFoundError') {
          setError('Không tìm thấy camera trên thiết bị này.')
        } else {
          setError('Không mở được camera. Cần HTTPS/localhost, hoặc dùng nút "Tải ảnh".')
        }
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Vẽ khung hình hiện tại ra canvas (tuỳ chọn thu nhỏ) rồi tạo File JPEG.
  const grabFrame = (maxDim: number, quality: number): Promise<File | null> =>
    new Promise((resolve) => {
      const v = videoRef.current
      if (!v || !v.videoWidth || !v.videoHeight) return resolve(null)
      const scale = maxDim > 0 ? Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight)) : 1
      const w = Math.round(v.videoWidth * scale)
      const h = Math.round(v.videoHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(v, 0, 0, w, h)
      canvas.toBlob((b) => resolve(b ? new File([b], `frame-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null), 'image/jpeg', quality)
    })

  // Lấy mẫu tí hon (grayscale) để đo mức thay đổi giữa 2 khung.
  const sampleTiny = (): Uint8ClampedArray | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const s = 16
    const c = document.createElement('canvas')
    c.width = s
    c.height = s
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, s, s)
    const data = ctx.getImageData(0, 0, s, s).data
    const gray = new Uint8ClampedArray(s * s)
    for (let i = 0; i < s * s; i++) {
      gray[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3
    }
    return gray
  }

  const frameDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
    return sum / a.length
  }

  // Khớp box mới nhận diện với các track hiện có (greedy theo khoảng cách tâm),
  // cập nhật đích để animation nội suy tới; thêm track mới, xoá track lạc quá lâu.
  const applyDetections = (dets: Box[]) => {
    const tracks = tracksRef.current
    const pairs: { d: number; ti: number; di: number }[] = []
    tracks.forEach((t, ti) =>
      dets.forEach((d, di) => {
        const dist = Math.hypot(cx(t.cur) - cx(d), cy(t.cur) - cy(d))
        if (dist < MATCH_DIST) pairs.push({ d: dist, ti, di })
      }),
    )
    pairs.sort((p, q) => p.d - q.d)
    const usedT = new Set<number>()
    const usedD = new Set<number>()
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue
      usedT.add(p.ti)
      usedD.add(p.di)
      tracks[p.ti].target = dets[p.di]
      tracks[p.ti].missed = 0
    }
    // Box mới chưa khớp track nào → tạo track mới (xuất hiện tại đúng vị trí).
    dets.forEach((d, di) => {
      if (!usedD.has(di)) tracks.push({ id: nextIdRef.current++, cur: d, target: d, missed: 0 })
    })
    // Track không được khớp lần này → tăng missed; quá ngưỡng thì bỏ.
    tracksRef.current = tracks.filter((t, ti) => {
      if (usedT.has(ti)) return true
      t.missed++
      return t.missed <= MAX_MISSED
    })
  }

  // Vòng lặp gửi khung nhận diện (throttle + chỉ gửi khi đổi đáng kể).
  useEffect(() => {
    if (!ready || error) return
    let active = true
    let timer: number | undefined
    const tick = async () => {
      if (!active) return
      const sample = sampleTiny()
      const prev = prevSampleRef.current
      const shouldSend =
        !prev || tracksRef.current.length === 0 || (sample != null && frameDiff(sample, prev) >= DIFF_THRESHOLD)
      if (shouldSend) {
        const f = await grabFrame(LIVE_MAX_DIM, LIVE_QUALITY)
        if (f && active) {
          try {
            const res = await countBoxes([f])
            if (active) {
              // Cùng điều kiện với review: bỏ box quá nhỏ + khử chồng > 0.25.
              applyDetections(cleanupDetections(res.per_image?.[0]?.boxes ?? []))
              if (sample) prevSampleRef.current = sample
            }
          } catch {
            /* bỏ qua khung lỗi, thử lại lần sau */
          }
        }
      }
      if (active) timer = window.setTimeout(tick, SEND_GAP)
    }
    tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [ready, error])

  // Vòng lặp animation: nội suy vị trí box tiến dần tới đích cho mượt.
  useEffect(() => {
    if (!ready || error) return
    let raf = 0
    const animate = () => {
      const tracks = tracksRef.current
      tracks.forEach((t) => {
        t.cur = lerpBox(t.cur, t.target, EASE)
      })
      if (tracks.length > 0 || lastCountRef.current > 0) {
        setDisplayBoxes(tracks.map((t) => t.cur))
        lastCountRef.current = tracks.length
      }
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [ready, error])

  const capture = async () => {
    // Lấy ảnh full-res (không thu nhỏ, chất lượng cao) để lưu & review.
    const file = await grabFrame(0, 0.92)
    if (!file) return
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onCapture(file)
  }

  return (
    <div className="modal-overlay scanner-overlay" onClick={onClose}>
      <div className="modal scanner-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Chụp ảnh kiểm đếm</h2>
          <p className="modal-subtitle">
            Đưa thùng hàng vào khung — hệ thống nhận diện trực tiếp. Bấm Chụp khi khung box đã đúng.
          </p>
        </div>

        {error ? (
          <div className="alert alert-error">{error}</div>
        ) : (
          <div style={{ position: 'relative', lineHeight: 0 }}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', maxHeight: '70vh', borderRadius: 8, background: '#000', display: 'block' }}
            />
            {/* Overlay khung box nhận diện live (đã làm mượt), toạ độ chuẩn hoá 0..1. */}
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              {displayBoxes.map((b, i) => (
                <rect
                  key={i}
                  x={Math.min(b.x1, b.x2)}
                  y={Math.min(b.y1, b.y2)}
                  width={Math.abs(b.x2 - b.x1)}
                  height={Math.abs(b.y2 - b.y1)}
                  fill="rgba(16,185,129,0.12)"
                  stroke="#10b981"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                background: 'rgba(17,24,39,0.72)',
                color: '#fff',
                fontSize: '0.8rem',
                padding: '2px 10px',
                borderRadius: 999,
              }}
            >
              Nhận diện: {displayBoxes.length} box
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Đóng
          </button>
          {!error && (
            <button type="button" className="btn btn-primary" onClick={capture} disabled={!ready}>
              📷 Chụp
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
