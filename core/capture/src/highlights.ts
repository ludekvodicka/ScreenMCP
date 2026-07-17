import type { HighlightRect } from './types'

interface Size {
  width: number
  height: number
}

type Color = readonly [red: number, green: number, blue: number, alpha: number]

export const HIGHLIGHT_STROKE_COLOR = { r: 0xff, g: 0xd4, b: 0x00 } as const
export const HIGHLIGHT_MAX_PER_SOURCE = 12

const YELLOW: Color = [HIGHLIGHT_STROKE_COLOR.r, HIGHLIGHT_STROKE_COLOR.g, HIGHLIGHT_STROKE_COLOR.b, 255]
const DARK: Color = [0x10, 0x10, 0x10, 255]
const DIGIT_GLYPHS: readonly (readonly number[])[] = [
  [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  [0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110],
  [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function fillRect(rgba: Uint8Array, frameWidth: number, frameHeight: number, x: number, y: number, width: number, height: number, color: Color): void {
  const left = clamp(Math.floor(x), 0, frameWidth)
  const top = clamp(Math.floor(y), 0, frameHeight)
  const right = clamp(Math.ceil(x + width), 0, frameWidth)
  const bottom = clamp(Math.ceil(y + height), 0, frameHeight)
  for (let row = top; row < bottom; row++) {
    for (let column = left; column < right; column++) {
      const index = (row * frameWidth + column) * 4
      rgba[index] = color[0]
      rgba[index + 1] = color[1]
      rgba[index + 2] = color[2]
      rgba[index + 3] = color[3]
    }
  }
}

function drawOutsideOutline(rgba: Uint8Array, frameWidth: number, frameHeight: number, left: number, top: number, right: number, bottom: number, thickness: number, color: Color): void {
  if (right <= left || bottom <= top) return
  fillRect(rgba, frameWidth, frameHeight, left - thickness, top - thickness, right - left + thickness * 2, thickness, color)
  fillRect(rgba, frameWidth, frameHeight, left - thickness, bottom, right - left + thickness * 2, thickness, color)
  fillRect(rgba, frameWidth, frameHeight, left - thickness, top, thickness, bottom - top, color)
  fillRect(rgba, frameWidth, frameHeight, right, top, thickness, bottom - top, color)
}

function drawBadge(rgba: Uint8Array, frameWidth: number, frameHeight: number, highlight: HighlightRect, number: number, strokeWidth: number): void {
  const digits = `${number}`
  const cell = Math.max(1, Math.round(strokeWidth / 3) * 2)
  const padding = cell
  const gap = cell
  const plateWidth = padding * 2 + digits.length * 5 * cell + (digits.length - 1) * gap
  const plateHeight = padding * 2 + 7 * cell
  const rectLeft = Math.floor(highlight.x)
  const rectTop = Math.floor(highlight.y)
  const rectRight = Math.ceil(highlight.x + highlight.width)
  const rectBottom = Math.ceil(highlight.y + highlight.height)
  const positions = [
    { left: rectLeft, top: rectTop - strokeWidth - plateHeight },
    { left: rectLeft, top: rectBottom + strokeWidth },
    { left: rectRight + strokeWidth, top: rectTop },
    { left: rectLeft - strokeWidth - plateWidth, top: rectTop },
  ]
  const outside = positions.find(position => position.left >= 0 && position.top >= 0 && position.left + plateWidth <= frameWidth && position.top + plateHeight <= frameHeight)
  const left = outside?.left ?? clamp(rectLeft, 0, Math.max(0, frameWidth - plateWidth))
  const top = outside?.top ?? clamp(rectBottom + strokeWidth, 0, Math.max(0, frameHeight - plateHeight))
  fillRect(rgba, frameWidth, frameHeight, left, top, plateWidth, plateHeight, YELLOW)
  for (let digitIndex = 0; digitIndex < digits.length; digitIndex++) {
    const glyph = DIGIT_GLYPHS[Number(digits[digitIndex])]
    if (!glyph) throw new Error(`Unknown badge digit: ${JSON.stringify(digits[digitIndex])}`)
    const glyphLeft = left + padding + digitIndex * (5 * cell + gap)
    for (let row = 0; row < glyph.length; row++) {
      const bits = glyph[row]
      if (bits === undefined) throw new Error(`Missing badge glyph row: ${row}`)
      for (let column = 0; column < 5; column++) {
        if ((bits & (1 << (4 - column))) !== 0)
          fillRect(rgba, frameWidth, frameHeight, glyphLeft + column * cell, top + padding + row * cell, cell, cell, DARK)
      }
    }
  }
}

export function scaleHighlights(highlights: readonly HighlightRect[], source: Size, target: Size): HighlightRect[] {
  if (source.width < 1 || source.height < 1 || target.width < 1 || target.height < 1) throw new RangeError('Highlight coordinate spaces must be positive')
  const scaleX = target.width / source.width
  const scaleY = target.height / source.height
  return highlights.map(highlight => {
    if (highlight.shape === 'rect')
      return { id: highlight.id, shape: 'rect', ...(highlight.label === undefined ? {} : { label: highlight.label }), x: highlight.x * scaleX, y: highlight.y * scaleY, width: highlight.width * scaleX, height: highlight.height * scaleY }
    else throw new Error(`Unknown highlight shape: ${JSON.stringify(highlight.shape)}`)
  })
}

export function drawHighlights(rgba: Uint8Array, width: number, height: number, highlights: readonly HighlightRect[], strokeWidth: number): void {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match frame dimensions')
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) throw new RangeError('Highlight stroke width must be positive')
  const stroke = Math.max(1, Math.round(strokeWidth))
  const halo = Math.max(1, Math.round(stroke / 3))
  highlights.forEach((highlight, index) => {
    if (highlight.shape === 'rect') {
      const left = Math.floor(highlight.x)
      const top = Math.floor(highlight.y)
      const right = Math.ceil(highlight.x + highlight.width)
      const bottom = Math.ceil(highlight.y + highlight.height)
      // Shift the outward stroke inward on any side flush with the frame, otherwise an edge-flush (or full-frame) rect loses that band entirely.
      const ringLeft = Math.max(left, stroke)
      const ringTop = Math.max(top, stroke)
      const ringRight = Math.min(right, width - stroke)
      const ringBottom = Math.min(bottom, height - stroke)
      drawOutsideOutline(rgba, width, height, ringLeft - stroke, ringTop - stroke, ringRight + stroke, ringBottom + stroke, halo, DARK)
      drawOutsideOutline(rgba, width, height, ringLeft, ringTop, ringRight, ringBottom, stroke, YELLOW)
      drawBadge(rgba, width, height, highlight, index + 1, stroke)
    } else throw new Error(`Unknown highlight shape: ${JSON.stringify(highlight.shape)}`)
  })
}
