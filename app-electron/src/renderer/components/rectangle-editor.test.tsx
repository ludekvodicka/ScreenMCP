import { describe, expect, it } from 'vitest'
import {
  advanceRectangleInteraction,
  createDrawInteraction,
  normalizeRectangle,
  resizeRectangle,
  resizeRectangleByDelta,
  translateRectangle,
  type RectangleInteraction,
  type ResizeEdge,
  type ResizeHandle,
} from './RectangleEditor'

describe('rectangle editor geometry', () => {
  it('normalizes a draft drawn in either direction', () => {
    expect(normalizeRectangle({ x: 20, y: 30 }, { x: 70, y: 90 })).toEqual({ x: 20, y: 30, width: 50, height: 60 })
    expect(normalizeRectangle({ x: 70, y: 90 }, { x: 20, y: 30 })).toEqual({ x: 20, y: 30, width: 50, height: 60 })
  })

  it('resizes from every side while preserving the opposite side', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangle(rect, 'top', { x: 0, y: 10 }, 100, 100)).toEqual({ x: 20, y: 10, width: 40, height: 70 })
    expect(resizeRectangle(rect, 'right', { x: 90, y: 0 }, 100, 100)).toEqual({ x: 20, y: 30, width: 70, height: 50 })
    expect(resizeRectangle(rect, 'bottom', { x: 0, y: 95 }, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 65 })
    expect(resizeRectangle(rect, 'left', { x: 5, y: 0 }, 100, 100)).toEqual({ x: 5, y: 30, width: 55, height: 50 })
  })

  it('clamps resized sides to source bounds and the six-pixel minimum', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangle(rect, 'top', { x: 0, y: -20 }, 100, 100)).toEqual({ x: 20, y: 0, width: 40, height: 80 })
    expect(resizeRectangle(rect, 'right', { x: 140, y: 0 }, 100, 100)).toEqual({ x: 20, y: 30, width: 80, height: 50 })
    expect(resizeRectangle(rect, 'bottom', { x: 0, y: 140 }, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 70 })
    expect(resizeRectangle(rect, 'left', { x: -20, y: 0 }, 100, 100)).toEqual({ x: 0, y: 30, width: 60, height: 50 })
    expect(resizeRectangle(rect, 'top', { x: 0, y: 79 }, 100, 100)).toEqual({ x: 20, y: 74, width: 40, height: 6 })
    expect(resizeRectangle(rect, 'right', { x: 21, y: 0 }, 100, 100)).toEqual({ x: 20, y: 30, width: 6, height: 50 })
    expect(resizeRectangle(rect, 'bottom', { x: 0, y: 31 }, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 6 })
    expect(resizeRectangle(rect, 'left', { x: 59, y: 0 }, 100, 100)).toEqual({ x: 54, y: 30, width: 6, height: 50 })
  })

  it('applies resize as pointer delta without jumping to the grab position inside a hit zone', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangleByDelta(rect, 'top', 0, -10, 100, 100)).toEqual({ x: 20, y: 20, width: 40, height: 60 })
    expect(resizeRectangleByDelta(rect, 'right', 10, 0, 100, 100)).toEqual({ x: 20, y: 30, width: 50, height: 50 })
    expect(resizeRectangleByDelta(rect, 'bottom', 0, 10, 100, 100)).toEqual({ x: 20, y: 30, width: 40, height: 60 })
    expect(resizeRectangleByDelta(rect, 'left', -10, 0, 100, 100)).toEqual({ x: 10, y: 30, width: 50, height: 50 })
  })

  it('resizes from every corner along both adjacent axes', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangleByDelta(rect, 'top-left', -10, -15, 100, 100)).toEqual({ x: 10, y: 15, width: 50, height: 65 })
    expect(resizeRectangleByDelta(rect, 'top-right', 15, -10, 100, 100)).toEqual({ x: 20, y: 20, width: 55, height: 60 })
    expect(resizeRectangleByDelta(rect, 'bottom-right', 20, 15, 100, 100)).toEqual({ x: 20, y: 30, width: 60, height: 65 })
    expect(resizeRectangleByDelta(rect, 'bottom-left', -15, 10, 100, 100)).toEqual({ x: 5, y: 30, width: 55, height: 60 })
  })

  it('clamps both corner axes independently to bounds and minimum size', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangleByDelta(rect, 'top-left', -100, -100, 100, 100)).toEqual({ x: 0, y: 0, width: 60, height: 80 })
    expect(resizeRectangleByDelta(rect, 'top-right', 100, -100, 100, 100)).toEqual({ x: 20, y: 0, width: 80, height: 80 })
    expect(resizeRectangleByDelta(rect, 'bottom-right', 100, 100, 100, 100)).toEqual({ x: 20, y: 30, width: 80, height: 70 })
    expect(resizeRectangleByDelta(rect, 'bottom-left', -100, 100, 100, 100)).toEqual({ x: 0, y: 30, width: 60, height: 70 })
    expect(resizeRectangleByDelta(rect, 'top-left', 100, 100, 100, 100)).toEqual({ x: 54, y: 74, width: 6, height: 6 })
    expect(resizeRectangleByDelta(rect, 'top-right', -100, 100, 100, 100)).toEqual({ x: 20, y: 74, width: 6, height: 6 })
    expect(resizeRectangleByDelta(rect, 'bottom-right', -100, -100, 100, 100)).toEqual({ x: 20, y: 30, width: 6, height: 6 })
    expect(resizeRectangleByDelta(rect, 'bottom-left', 100, -100, 100, 100)).toEqual({ x: 54, y: 30, width: 6, height: 6 })
    expect(resizeRectangleByDelta(rect, 'bottom-right', 100, -100, 100, 100)).toEqual({ x: 20, y: 30, width: 80, height: 6 })
  })

  it('keeps corner geometry unchanged at zero pointer delta', () => {
    const rect = { x: 20, y: 30, width: 40, height: 50 }

    expect(resizeRectangleByDelta(rect, 'top-left', 0, 0, 100, 100)).toEqual(rect)
    expect(resizeRectangleByDelta(rect, 'top-right', 0, 0, 100, 100)).toEqual(rect)
    expect(resizeRectangleByDelta(rect, 'bottom-right', 0, 0, 100, 100)).toEqual(rect)
    expect(resizeRectangleByDelta(rect, 'bottom-left', 0, 0, 100, 100)).toEqual(rect)
  })

  it('clamps movement on all source edges', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 }

    expect(translateRectangle(rect, -40, 80, 100, 100)).toEqual({ x: 0, y: 60, width: 30, height: 40 })
    expect(translateRectangle(rect, 200, -100, 100, 100)).toEqual({ x: 70, y: 0, width: 30, height: 40 })
  })

  it('moves a live draft at constant size while Ctrl is held and resumes sizing after release', () => {
    let interaction: RectangleInteraction = createDrawInteraction({ x: 20, y: 20 })
    interaction = advanceRectangleInteraction(interaction, { x: 60, y: 50 }, false, 100, 100)
    expect(interaction.rect).toEqual({ x: 20, y: 20, width: 40, height: 30 })

    interaction = advanceRectangleInteraction(interaction, { x: 70, y: 65 }, true, 100, 100)
    expect(interaction.rect).toEqual({ x: 30, y: 35, width: 40, height: 30 })

    interaction = advanceRectangleInteraction(interaction, { x: 80, y: 75 }, false, 100, 100)
    expect(interaction.rect).toEqual({ x: 30, y: 35, width: 50, height: 40 })
  })

  it('does not jump when Ctrl translation reaches a source edge', () => {
    let interaction: RectangleInteraction = createDrawInteraction({ x: 80, y: 80 })
    interaction = advanceRectangleInteraction(interaction, { x: 40, y: 40 }, false, 100, 100)
    interaction = advanceRectangleInteraction(interaction, { x: 100, y: 100 }, true, 100, 100)
    expect(interaction.rect).toEqual({ x: 60, y: 60, width: 40, height: 40 })

    interaction = advanceRectangleInteraction(interaction, { x: 100, y: 100 }, false, 100, 100)
    expect(interaction.rect).toEqual({ x: 60, y: 60, width: 40, height: 40 })
  })

  it('throws for unknown fixed-set variants', () => {
    const interaction = { kind: 'rotate' } as unknown as RectangleInteraction
    expect(() => advanceRectangleInteraction(interaction, { x: 0, y: 0 }, false, 100, 100)).toThrow('Unknown rectangle interaction')
    expect(() => resizeRectangle({ x: 10, y: 10, width: 20, height: 20 }, 'diagonal' as ResizeEdge, { x: 0, y: 0 }, 100, 100)).toThrow('Unknown rectangle resize edge')
    expect(() => resizeRectangleByDelta({ x: 10, y: 10, width: 20, height: 20 }, 'center' as ResizeHandle, 0, 0, 100, 100)).toThrow('Unknown rectangle resize handle')
  })
})
