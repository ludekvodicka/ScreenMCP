import { describe, expect, it } from 'vitest'
import { applyMasks, scaleMasks } from '../src/masks'

describe('applyMasks', () => {
  it('blackens only pixels inside the rectangle', () => {
    const rgba = new Uint8Array(4 * 3 * 4).fill(200)
    applyMasks(rgba, 4, 3, [{ id: 'secret', x: 1, y: 1, width: 2, height: 1 }])
    expect([...rgba.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)]).toEqual([0, 0, 0, 255])
    expect([...rgba.slice(0, 4)]).toEqual([200, 200, 200, 200])
  })

  it('maps canonical masks when a live source changes size', () => {
    expect(scaleMasks(
      [{ id: 'secret', x: 5, y: 2, width: 10, height: 4 }],
      { width: 20, height: 10 },
      { width: 40, height: 20 },
    )).toEqual([{ id: 'secret', x: 10, y: 4, width: 20, height: 8 }])
  })
})
