import type { MaskRect } from './types'

interface Size {
  width: number
  height: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function applyMasks(rgba: Uint8Array, width: number, height: number, masks: readonly MaskRect[]): void {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match frame dimensions')
  for (const mask of masks) {
    const left = clamp(Math.floor(mask.x), 0, width)
    const top = clamp(Math.floor(mask.y), 0, height)
    const right = clamp(Math.ceil(mask.x + mask.width), 0, width)
    const bottom = clamp(Math.ceil(mask.y + mask.height), 0, height)
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const index = (y * width + x) * 4
        rgba[index] = 0
        rgba[index + 1] = 0
        rgba[index + 2] = 0
        rgba[index + 3] = 255
      }
    }
  }
}

export function scaleMasks(masks: readonly MaskRect[], source: Size, target: Size): MaskRect[] {
  if (source.width < 1 || source.height < 1 || target.width < 1 || target.height < 1) throw new RangeError('Mask coordinate spaces must be positive')
  const scaleX = target.width / source.width
  const scaleY = target.height / source.height
  return masks.map(mask => ({ id: mask.id, x: mask.x * scaleX, y: mask.y * scaleY, width: mask.width * scaleX, height: mask.height * scaleY }))
}
