import { describe, expect, it } from 'vitest'
import type { SourceSelection } from '../shared/contracts'
import { CoordinateResolver, type CoordinateEnvironment } from './coordinate-resolver'

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
const scaled = { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }

function environment(): CoordinateEnvironment {
  return {
    platform: 'win32',
    getAllDisplays: () => [primary, scaled],
    dipToScreenPoint: point => point.x < 0 ? { x: -1920 + (point.x + 1280) * 1.5, y: point.y * 1.5 } : point,
    screenToDipPoint: point => point.x < 0 ? { x: -1280 + (point.x + 1920) / 1.5, y: point.y / 1.5 } : point,
    windowById: id => Promise.resolve(id === 77 ? { id, bounds: { x: 100, y: 200, width: 1000, height: 500 } } : null),
  }
}

describe('CoordinateResolver', () => {
  it('round-trips monitor payload pixels through physical screen pixels', async () => {
    const resolver = new CoordinateResolver(() => null, environment())
    const selection = monitor()
    const screen = await resolver.toScreen(selection, { x: 960, y: 540 })
    expect(screen).toEqual({ x: 960, y: 540 })
    await expect(resolver.toPayload(selection, { x: 860, y: 490, width: 200, height: 100 })).resolves.toEqual({ x: 860, y: 490, width: 200, height: 100 })
  })

  it('adds a region origin before mapping to the display', async () => {
    const resolver = new CoordinateResolver(() => null, environment())
    const selection: SourceSelection = { captureId: 'screen:1:0', kind: 'region', label: 'Region', region: { x: 480, y: 270, width: 960, height: 540 }, width: 960, height: 540, captureWidth: 1920, captureHeight: 1080 }
    await expect(resolver.toScreen(selection, { x: 480, y: 270 })).resolves.toEqual({ x: 960, y: 540 })
    await expect(resolver.sourceScreenBounds(selection)).resolves.toEqual({ x: 480, y: 270, width: 960, height: 540 })
  })

  it('maps a downscaled window against a fresh physical HWND rect', async () => {
    const resolver = new CoordinateResolver(() => 1000, environment())
    const selection: SourceSelection = { captureId: 'window:77:0', kind: 'window', label: 'Editor', width: 2000, height: 1000 }
    await expect(resolver.toScreen(selection, { x: 500, y: 250 })).resolves.toEqual({ x: 600, y: 450 })
    await expect(resolver.toPayload(selection, { x: 350, y: 300, width: 250, height: 100 })).resolves.toEqual({ x: 250, y: 100, width: 250, height: 100 })
  })

  it('reuses precomputed window bounds without re-inspecting the HWND', async () => {
    let windowCalls = 0
    const env: CoordinateEnvironment = { ...environment(), windowById: id => { windowCalls++; return Promise.resolve({ id, bounds: { x: 100, y: 200, width: 1000, height: 500 } }) } }
    const resolver = new CoordinateResolver(() => 1000, env)
    const selection: SourceSelection = { captureId: 'window:77:0', kind: 'window', label: 'Editor', width: 2000, height: 1000 }
    await expect(resolver.toPayload(selection, { x: 350, y: 300, width: 250, height: 100 }, { x: 100, y: 200, width: 1000, height: 500 })).resolves.toEqual({ x: 250, y: 100, width: 250, height: 100 })
    expect(windowCalls).toBe(0)
  })

  it('handles a negative-origin 150% display without a global scale factor', async () => {
    const resolver = new CoordinateResolver(() => null, environment())
    const selection: SourceSelection = { captureId: 'screen:2:0', kind: 'monitor', label: 'Scaled', width: 1920, height: 1080, captureWidth: 1920, captureHeight: 1080 }
    await expect(resolver.toScreen(selection, { x: 960, y: 540 })).resolves.toEqual({ x: -960, y: 540 })
    await expect(resolver.toPayload(selection, { x: -1110, y: 465, width: 300, height: 150 })).resolves.toEqual({ x: 810, y: 465, width: 300, height: 150 })
  })

  it('resolves an index-based capture id through the selection displayId', async () => {
    const resolver = new CoordinateResolver(() => null, environment())
    // Windows desktopCapturer ids are often index-based (screen:0:0); only displayId identifies the display
    const selection: SourceSelection = { captureId: 'screen:0:0', kind: 'monitor', label: 'Primary', width: 1920, height: 1080, captureWidth: 1920, captureHeight: 1080, displayId: '1' }
    await expect(resolver.toScreen(selection, { x: 960, y: 540 })).resolves.toEqual({ x: 960, y: 540 })
    const without: SourceSelection = { ...selection, displayId: undefined }
    await expect(resolver.toScreen(without, { x: 960, y: 540 })).rejects.toMatchObject({ code: 'control_unavailable' })
  })

  it('rejects payload points and element rectangles outside the source', async () => {
    const resolver = new CoordinateResolver(() => null, environment())
    const selection = monitor()
    await expect(resolver.toScreen(selection, { x: 1920, y: 0 })).rejects.toMatchObject({ code: 'out_of_bounds' })
    await expect(resolver.assertWithinSource(selection, { x: 1900, y: 10, width: 40, height: 20 })).rejects.toMatchObject({ code: 'out_of_bounds' })
    expect(() => resolver.assertPayloadRect(selection, { x: -1, y: 0, width: 10, height: 10 })).toThrow(expect.objectContaining({ code: 'out_of_bounds' }))
  })
})

function monitor(): SourceSelection {
  return { captureId: 'screen:1:0', kind: 'monitor', label: 'Primary', width: 1920, height: 1080, captureWidth: 1920, captureHeight: 1080 }
}
