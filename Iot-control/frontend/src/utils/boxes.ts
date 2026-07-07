import type { DetBox } from '../types'

// Chuẩn hoá box để x1<x2, y1<y2 (sau khi kéo có thể ngược chiều).
export const normalize = (b: DetBox): DetBox => ({
  x1: Math.min(b.x1, b.x2),
  y1: Math.min(b.y1, b.y2),
  x2: Math.max(b.x1, b.x2),
  y2: Math.max(b.y1, b.y2),
  conf: b.conf,
})

// Diện tích 1 box (toạ độ chuẩn hoá 0..1).
export const area = (b: DetBox): number => (b.x2 - b.x1) * (b.y2 - b.y1)

// Diện tích phần giao của 2 box (toạ độ chuẩn hoá 0..1).
export const interArea = (a: DetBox, b: DetBox): number => {
  const iw = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const ih = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  return iw * ih
}

// IoU của 2 box (toạ độ chuẩn hoá 0..1).
export const iou = (a: DetBox, b: DetBox): number => {
  const inter = interArea(a, b)
  const uni = area(a) + area(b) - inter
  return uni > 0 ? inter / uni : 0
}

// Hai box coi là "chồng" (một trong hai thừa) khi diện tích giao ≥ hệ số này ×
// diện tích của box NHỎ hơn (tức chồng > 0.25 diện tích khung gần đó).
export const OVERLAP_RATIO = 0.25

// Thống kê quá trình dọn: box giữ lại + số box bị lọc theo từng lý do.
export interface CleanupStats {
  boxes: DetBox[]
  removedSmall: number   // số box bị bỏ vì diện tích quá nhỏ
  removedOverlap: number // số box bị bỏ vì chồng box khác
}

// Dọn kết quả detect và trả kèm thống kê: (1) bỏ box có diện tích < nửa diện tích
// trung bình các box detect được, (2) khử box chồng nhau > OVERLAP_RATIO diện tích
// của khung nhỏ hơn (giữ box lớn hơn) — không còn cặp box nào chồng quá ngưỡng.
export const cleanupWithStats = (raw: DetBox[]): CleanupStats => {
  const normed = raw.map(normalize)
  if (normed.length === 0) return { boxes: normed, removedSmall: 0, removedOverlap: 0 }
  const avgArea = normed.reduce((s, b) => s + area(b), 0) / normed.length
  const minArea = avgArea / 2
  const kept: DetBox[] = []
  let removedSmall = 0
  let removedOverlap = 0
  // Duyệt từ box lớn đến nhỏ: giữ box không quá nhỏ và không chồng > ngưỡng.
  for (const b of [...normed].sort((p, q) => area(q) - area(p))) {
    if (area(b) < minArea) {
      removedSmall++
      continue
    }
    const overlaps = kept.some(
      (k) => interArea(b, k) >= OVERLAP_RATIO * Math.min(area(b), area(k)),
    )
    if (overlaps) {
      removedOverlap++
      continue
    }
    kept.push(b)
  }
  return { boxes: kept, removedSmall, removedOverlap }
}

// Chỉ lấy danh sách box đã dọn (bỏ qua thống kê).
export const cleanupDetections = (raw: DetBox[]): DetBox[] => cleanupWithStats(raw).boxes
