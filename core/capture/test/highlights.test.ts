import { describe, expect, it } from 'vitest'
import { drawHighlights, scaleHighlights } from '../src/highlights'
import type { HighlightRect } from '../src/types'

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4
  return [...rgba.slice(index, index + 4)]
}

describe('drawHighlights', () => {
  it('draws a yellow outline, dark halo, and bitmap badge without touching the interior', () => {
    const width = 60
    const height = 60
    const rgba = new Uint8Array(width * height * 4).fill(90)
    const center = (35 * width + 30) * 4
    rgba.set([0, 0, 0, 255], center)
    drawHighlights(rgba, width, height, [{ id: 'one', shape: 'rect', x: 15, y: 25, width: 30, height: 25 }], 3)

    expect(pixel(rgba, width, 14, 30)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 11, 30)).toEqual([16, 16, 16, 255])
    expect(pixel(rgba, width, 15, 30)).toEqual([90, 90, 90, 90])
    expect(pixel(rgba, width, 44, 30)).toEqual([90, 90, 90, 90])
    expect(pixel(rgba, width, 30, 25)).toEqual([90, 90, 90, 90])
    expect(pixel(rgba, width, 30, 49)).toEqual([90, 90, 90, 90])
    expect(pixel(rgba, width, 30, 35)).toEqual([0, 0, 0, 255])
    expect(pixel(rgba, width, 15, 4)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 21, 6)).toEqual([16, 16, 16, 255])
  })

  it('renders a two-digit badge for highlight 12', () => {
    const width = 220
    const height = 80
    const rgba = new Uint8Array(width * height * 4)
    const highlights = Array.from({ length: 12 }, (_, index): HighlightRect => ({ id: `${index}`, shape: 'rect', x: index * 17, y: 40, width: 12, height: 20 }))
    drawHighlights(rgba, width, height, highlights, 3)

    const darkPixels = Array.from({ length: 26 * 18 }, (_, index) => pixel(rgba, width, 187 + index % 26, 22 + Math.floor(index / 26))).filter(value => value[0] === 16 && value[1] === 16 && value[2] === 16)
    expect(darkPixels.length).toBeGreaterThan(0)
  })

  it('clamps rectangles that extend outside the frame', () => {
    const rgba = new Uint8Array(10 * 10 * 4)
    expect(() => drawHighlights(rgba, 10, 10, [{ id: 'edge', shape: 'rect', x: -3, y: 4, width: 8, height: 8 }], 2)).not.toThrow()
    expect([...rgba].some(value => value !== 0)).toBe(true)
  })

  it('keeps the outline visible for a rect flush with the top edge', () => {
    const width = 60
    const height = 60
    const rgba = new Uint8Array(width * height * 4)
    drawHighlights(rgba, width, height, [{ id: 'toolbar', shape: 'rect', x: 15, y: 0, width: 30, height: 20 }], 3)

    expect(pixel(rgba, width, 30, 0)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 30, 2)).toEqual([255, 212, 0, 255])
  })

  it('keeps a full-ring outline visible for a full-frame rect', () => {
    const width = 40
    const height = 40
    const rgba = new Uint8Array(width * height * 4)
    drawHighlights(rgba, width, height, [{ id: 'all', shape: 'rect', x: 0, y: 0, width, height }], 3)

    expect(pixel(rgba, width, 20, 0)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 20, 39)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 0, 20)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 39, 20)).toEqual([255, 212, 0, 255])
    expect(pixel(rgba, width, 20, 20)).toEqual([0, 0, 0, 0])
  })

  it('throws for an unknown shape', () => {
    const invalid = { id: 'future', shape: 'arrow', x: 1, y: 1, width: 2, height: 2 } as unknown as HighlightRect
    expect(() => drawHighlights(new Uint8Array(5 * 5 * 4), 5, 5, [invalid], 1)).toThrow('Unknown highlight shape')
  })
})

describe('scaleHighlights', () => {
  it('maps canonical coordinates and preserves semantic fields', () => {
    expect(scaleHighlights(
      [{ id: 'save', shape: 'rect', label: 'save button', x: 10, y: 20, width: 30, height: 40 }],
      { width: 100, height: 100 },
      { width: 200, height: 200 },
    )).toEqual([{ id: 'save', shape: 'rect', label: 'save button', x: 20, y: 40, width: 60, height: 80 }])
  })
})
