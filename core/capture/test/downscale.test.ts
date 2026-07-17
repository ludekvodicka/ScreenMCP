import { describe, expect, it } from 'vitest'
import { resizeRgbaNearest, targetDimensions } from '../src/downscale'

describe('downscale', () => {
  it('preserves aspect ratio and never upscales', () => {
    expect(targetDimensions(3840, 2160, 1568)).toEqual({ width: 1568, height: 882 })
    expect(targetDimensions(800, 600, 1568)).toEqual({ width: 800, height: 600 })
    expect(targetDimensions(3840, 2160, null)).toEqual({ width: 3840, height: 2160 })
  })

  it('resizes RGBA buffers', () => {
    const resized = resizeRgbaNearest(new Uint8Array(4 * 4 * 4).fill(123), 4, 4, { width: 2, height: 2 })
    expect(resized).toHaveLength(16)
    expect([...resized]).toEqual(new Array<number>(16).fill(123))
  })
})

