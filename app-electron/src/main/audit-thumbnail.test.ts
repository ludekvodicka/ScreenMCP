import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { applyMasks } from '../../../core/capture/src/masks'
import { encodeFrame } from '../../../core/capture/src/encode'
import { createAuditThumbnail } from './audit-thumbnail'

describe('audit thumbnails', () => {
  it.each([
    [2_000, 1_200, 960, 576],
    [1_200, 2_000, 360, 600],
    [100, 80, 100, 80],
  ])('bounds %sx%s input at %sx%s without enlargement', async (width, height, expectedWidth, expectedHeight) => {
    const input = await sharp({ create: { width, height, channels: 4, background: '#4a7b9fff' } }).png().toBuffer()
    await expect(sharp(await createAuditThumbnail(input)).metadata()).resolves.toMatchObject({ width: expectedWidth, height: expectedHeight, format: 'jpeg' })
  })

  it('is generated only from the redacted encoded frame', async () => {
    const rgba = new Uint8Array(48 * 32 * 4).fill(255)
    applyMasks(rgba, 48, 32, [{ id: 'all', x: 0, y: 0, width: 48, height: 32 }])
    const encoded = await encodeFrame({ rgba, width: 48, height: 32, capturedAt: 1, frameAgeMs: 0 }, { format: 'png', jpegQuality: 80, maxLongSide: null })
    const thumbnail = await createAuditThumbnail(encoded.data)
    const { data } = await sharp(thumbnail).raw().toBuffer({ resolveWithObject: true })
    const brightest = data.reduce((maximum, value) => Math.max(maximum, value), 0)
    expect(brightest).toBeLessThan(8)
  })
})
