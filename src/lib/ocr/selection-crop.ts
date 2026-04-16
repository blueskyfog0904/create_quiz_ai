export interface SelectionRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface VisualSize {
  width: number
  height: number
}

export interface IntrinsicSize {
  width: number
  height: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export function selectionToCropRect(
  selection: SelectionRect,
  visualSize: VisualSize,
  intrinsicSize: IntrinsicSize,
  padding = 12
): CropRect {
  const scaleX = intrinsicSize.width / visualSize.width
  const scaleY = intrinsicSize.height / visualSize.height

  const rawX = selection.x * scaleX
  const rawY = selection.y * scaleY
  const rawWidth = selection.width * scaleX
  const rawHeight = selection.height * scaleY

  const x = Math.max(0, Math.floor(rawX - padding))
  const y = Math.max(0, Math.floor(rawY - padding))
  const maxX = Math.min(intrinsicSize.width, Math.ceil(rawX + rawWidth + padding))
  const maxY = Math.min(intrinsicSize.height, Math.ceil(rawY + rawHeight + padding))

  return {
    x,
    y,
    width: Math.max(1, maxX - x),
    height: Math.max(1, maxY - y),
  }
}

export function buildOrderedCropRects(
  selections: SelectionRect[],
  visualSize: VisualSize,
  intrinsicSize: IntrinsicSize,
  padding = 12
): CropRect[] {
  return [...selections]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((selection) => selectionToCropRect(selection, visualSize, intrinsicSize, padding))
}
