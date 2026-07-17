import { describe, expect, it } from 'vitest'
import { dhash, hashDistance } from '../src/dhash'

function gradient(width: number, height: number, reverse = false): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = reverse ? 255 - x * 20 : x * 20
      const index = (y * width + x) * 4
      rgba.set([value, value, value, 255], index)
    }
  }
  return rgba
}

describe('dhash', () => {
  it('is stable and separates inverse gradients', () => {
    const left = dhash(gradient(9, 8), 9, 8)
    expect(dhash(gradient(9, 8), 9, 8)).toBe(left)
    expect(hashDistance(left, left)).toBe(0)
    expect(hashDistance(left, dhash(gradient(9, 8, true), 9, 8))).toBe(64)
  })
})

