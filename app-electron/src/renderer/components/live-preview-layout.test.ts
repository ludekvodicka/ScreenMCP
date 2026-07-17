import { describe, expect, it } from 'vitest'
import { previewCanvasStyle } from './LivePreview'

describe('previewCanvasStyle', () => {
  it.each([
    [960, 540],
    [1280, 1392],
  ])('fits a %sx%s frame by its exact aspect ratio', (width, height) => {
    expect(previewCanvasStyle(width, height)).toEqual({
      aspectRatio: `${width}/${height}`,
      maxWidth: `calc((100vh - 250px) * ${width / height})`,
    })
  })

  it.each([
    [0, 10],
    [10, 0],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ])('rejects an invalid %sx%s frame', (width, height) => {
    expect(() => previewCanvasStyle(width, height)).toThrow('Preview dimensions must be positive')
  })
})
