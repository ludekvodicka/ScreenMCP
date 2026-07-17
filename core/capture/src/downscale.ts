export interface Dimensions {
  width: number
  height: number
}

export function targetDimensions(width: number, height: number, maxLongSide: number | null): Dimensions {
  if (width < 1 || height < 1) throw new RangeError('Invalid frame dimensions')
  if (maxLongSide === null || Math.max(width, height) <= maxLongSide) return { width, height }
  if (maxLongSide < 1) throw new RangeError('maxLongSide must be positive or null')
  const scale = maxLongSide / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function resizeRgbaNearest(rgba: Uint8Array, width: number, height: number, target: Dimensions): Uint8Array {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match frame dimensions')
  const output = new Uint8Array(target.width * target.height * 4)
  for (let y = 0; y < target.height; y++) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / target.height))
    for (let x = 0; x < target.width; x++) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / target.width))
      const sourceIndex = (sourceY * width + sourceX) * 4
      const targetIndex = (y * target.width + x) * 4
      output[targetIndex] = rgba[sourceIndex] ?? 0
      output[targetIndex + 1] = rgba[sourceIndex + 1] ?? 0
      output[targetIndex + 2] = rgba[sourceIndex + 2] ?? 0
      output[targetIndex + 3] = rgba[sourceIndex + 3] ?? 255
    }
  }
  return output
}

