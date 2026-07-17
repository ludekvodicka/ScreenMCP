import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { encodeFrame, encodePreparedFrame, prepareFrame } from '../src/encode'

describe('encodeFrame', () => {
  it('encodes policy-sized JPEG and PNG frames', async () => {
    const width = 320
    const height = 180
    const rgba = new Uint8Array(width * height * 4)
    for (let index = 0; index < rgba.length; index += 4) rgba.set([index % 251, (index / 3) % 251, (index / 7) % 251, 255], index)
    const raw = { rgba, width, height, capturedAt: 10, frameAgeMs: 2 }
    const jpeg = await encodeFrame(raw, { format: 'jpeg', jpegQuality: 80, maxLongSide: 160 })
    const png = await encodeFrame(raw, { format: 'png', jpegQuality: 80, maxLongSide: null })
    expect(await sharp(jpeg.data).metadata()).toMatchObject({ width: 160, height: 90, format: 'jpeg' })
    expect(await sharp(png.data).metadata()).toMatchObject({ width: 320, height: 180, format: 'png' })
    expect(jpeg.hash).toMatch(/^[a-f\d]{16}$/)
  })

  it('prepares reusable resized pixels before encoding', async () => {
    const rgba = new Uint8Array(32 * 18 * 4).fill(255)
    const prepared = await prepareFrame({ rgba, width: 32, height: 18, capturedAt: 10, frameAgeMs: 2 }, 16)
    expect(prepared).toMatchObject({ width: 16, height: 9, capturedAt: 10, frameAgeMs: 2, nearlyBlack: false })
    expect(prepared.rgba).toHaveLength(16 * 9 * 4)
    const encoded = await encodePreparedFrame(prepared, { format: 'png', jpegQuality: 80, maxLongSide: 16 })
    expect(encoded.hash).toBe(prepared.hash)
    expect(await sharp(encoded.data).metadata()).toMatchObject({ width: 16, height: 9, format: 'png' })
  })
})
