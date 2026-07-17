import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { PreparedFrame } from '../../../core/capture/src/types'
import { OcrReader, cropPayloadRgba } from './ocr'

describe('OcrReader', () => {
  it('crops the redacted payload and offsets word boxes into payload pixels', async () => {
    const recognize = vi.fn(async (image: Buffer) => {
      const pixel = await sharp(image).raw().toBuffer()
      expect([...pixel.subarray(0, 4)]).toEqual([0, 0, 0, 255])
      return { data: { blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'Save', bbox: { x0: 1, y0: 2, x1: 9, y1: 8 } }] }] }] }] } }
    })
    const terminate = vi.fn(() => Promise.resolve())
    const reader = new OcrReader({ createRecognizer: () => Promise.resolve({ recognize, terminate }) })
    const frame = prepared(20, 20)
    const result = await reader.readRegion(frame, { x: 4, y: 5, width: 10, height: 10 })
    expect(result).toEqual({ text: 'Save', words: [{ text: 'Save', x: 5, y: 7, width: 8, height: 6 }], method: 'ocr' })
    await reader.dispose()
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('rejects regions outside the prepared model frame', () => {
    const frame = prepared(4, 4)
    expect(() => cropPayloadRgba(frame.rgba, 4, 4, { x: 3, y: 3, width: 2, height: 1 })).toThrow(expect.objectContaining({ code: 'out_of_bounds' }))
  })

  it('maps worker initialization failures to ocr_failed', async () => {
    const reader = new OcrReader({ createRecognizer: () => Promise.reject(new Error('WASM unavailable')) })
    const failure = reader.readRegion(prepared(4, 4), { x: 0, y: 0, width: 4, height: 4 })
    await expect(failure).rejects.toMatchObject({ code: 'ocr_failed' })
    await expect(failure).rejects.toThrow('WASM unavailable')
  })
})

function prepared(width: number, height: number): PreparedFrame {
  const rgba = new Uint8Array(width * height * 4)
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255
  return { rgba, width, height, hash: '0'.repeat(16), capturedAt: 0, frameAgeMs: 0, nearlyBlack: true }
}
