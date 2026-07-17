import type { RawFrame, Rect } from './types'

export function cropFrame(frame: RawFrame, rect: Rect): RawFrame {
  const x = Math.max(0, Math.min(frame.width - 1, Math.floor(rect.x)))
  const y = Math.max(0, Math.min(frame.height - 1, Math.floor(rect.y)))
  const width = Math.max(1, Math.min(frame.width - x, Math.floor(rect.width)))
  const height = Math.max(1, Math.min(frame.height - y, Math.floor(rect.height)))
  const rgba = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const sourceStart = ((y + row) * frame.width + x) * 4
    const targetStart = row * width * 4
    rgba.set(frame.rgba.subarray(sourceStart, sourceStart + width * 4), targetStart)
  }
  return { ...frame, rgba, width, height }
}

