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

// Ngưỡng "bao ngoài": khung A coi là CHỨA khung B khi phần giao ≥ hệ số này ×
// diện tích của B (tức ≥ 90% diện tích B nằm trong A). Khi đó A là khung bao
// ngoài -> loại A, giữ B (khung bị chứa).
export const CONTAIN_RATIO = 0.9

// Thống kê quá trình dọn: box giữ lại + số box bị lọc theo từng lý do.
export interface CleanupStats {
  boxes: DetBox[]
  removedSmall: number   // số box bị bỏ vì diện tích quá nhỏ
  removedOverlap: number // số box bị bỏ vì chồng box khác
}

// Lọc sau khi đã detect hết: nếu một khung CHỨA ≥ CONTAIN_RATIO (90%) diện tích
// của khung khác thì nó là khung bao ngoài -> LOẠI khung chứa, GIỮ khung bị chứa.
// Chỉ loại khung lớn hơn; nếu hai khung trùng khít (diện tích bằng nhau) thì loại
// khung xuất hiện sau để không mất cả hai.
export const cleanupWithStats = (raw: DetBox[]): CleanupStats => {
  const normed = raw.map(normalize)
  const n = normed.length
  if (n === 0) return { boxes: normed, removedSmall: 0, removedOverlap: 0 }
  const remove = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      // i chứa ≥90% diện tích của j?
      if (interArea(normed[i], normed[j]) < CONTAIN_RATIO * area(normed[j])) continue
      const ai = area(normed[i])
      const aj = area(normed[j])
      // Loại khung bao ngoài (lớn hơn); nếu bằng nhau, loại khung index lớn hơn.
      if (ai > aj || (ai === aj && i > j)) {
        remove[i] = true
        break
      }
    }
  }
  const kept: DetBox[] = []
  let removedOverlap = 0
  normed.forEach((b, i) => {
    if (remove[i]) removedOverlap++
    else kept.push(b)
  })
  return { boxes: kept, removedSmall: 0, removedOverlap }
}

// Chỉ lấy danh sách box đã dọn (bỏ qua thống kê).
export const cleanupDetections = (raw: DetBox[]): DetBox[] => cleanupWithStats(raw).boxes
