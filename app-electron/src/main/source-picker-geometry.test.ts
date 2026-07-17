import { describe, expect, it } from 'vitest'
import { matchCaptureWindowSource, matchWindowTargets, rectangleChoice, sourceRect, windowAtPoint, windowsInSnapshotOrder, win32WindowCaptureId } from './source-picker-geometry'

describe('source picker geometry', () => {
  it('ignores clicks and accepts only a meaningful region drag', () => {
    expect(rectangleChoice({ x: 100, y: 100 }, { x: 104, y: 96 }, { width: 1_280, height: 720 })).toBeNull()
    expect(rectangleChoice({ x: 100, y: 100 }, { x: 108, y: 150 }, { width: 1_280, height: 720 })).toBeNull()
    expect(rectangleChoice({ x: 960, y: 540 }, { x: 320, y: 180 }, { width: 1_280, height: 720 })).toEqual({ kind: 'region', region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })
  })

  it('maps normalized display geometry to real capture pixels', () => {
    expect(sourceRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, { width: 3_840, height: 2_160 })).toEqual({ x: 960, y: 540, width: 1_920, height: 1_080 })
    expect(sourceRect({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, { width: 1_000, height: 1_000 })).toEqual({ x: 999, y: 999, width: 1, height: 1 })
  })

  it('matches signed Windows HWND values to unsigned Electron source ids', () => {
    const native = [{ id: -2_147_483_647, title: 'Editor', bounds: { x: -1_280, y: 0, width: 1_280, height: 720 }, owner: { processId: 42 } }]
    const sources = [
      { id: 'window:2147483649:0', name: 'Editor source' },
      { id: 'window:2147483649:1', name: 'Own source' },
    ]
    expect(matchWindowTargets(native, sources, 7, 'win32')).toEqual([{ id: 'window:2147483649:0', label: 'Editor source', bounds: native[0]!.bounds }])
    expect(matchCaptureWindowSource(native[0]!.id, sources, 'win32')).toEqual(sources[0])
    expect(win32WindowCaptureId(native[0]!.id)).toBe('window:2147483649:0')
    expect(() => win32WindowCaptureId(0)).toThrow('Invalid native window id')
  })

  it('keeps front-to-back order, excludes this process, and hit-tests negative origins', () => {
    const native = [
      { id: 10, title: 'Front', bounds: { x: -500, y: -100, width: 400, height: 300 }, owner: { processId: 1 } },
      { id: 11, title: 'Back', bounds: { x: -600, y: -200, width: 700, height: 500 }, owner: { processId: 2 } },
      { id: 12, title: 'ScreenMCP', bounds: { x: 0, y: 0, width: 100, height: 100 }, owner: { processId: 99 } },
    ]
    const sources = native.map(window => ({ id: `window:${window.id}:0`, name: window.title }))
    const targets = matchWindowTargets(native, sources, 99, 'linux')
    expect(targets.map(target => target.label)).toEqual(['Front', 'Back'])
    expect(windowAtPoint(targets, { x: -200, y: 0 })?.label).toBe('Front')
    expect(windowAtPoint(targets, { x: 50, y: 250 })?.label).toBe('Back')
    expect(windowAtPoint(targets, { x: 500, y: 500 })).toBeNull()
  })

  it('does not fall through a disabled but capturable front app window to the window behind it', () => {
    const bounds = { x: 100, y: 100, width: 900, height: 700 }
    const native = [
      { id: 30, title: 'Total Commander', bounds, owner: { processId: 3 } },
      { id: 40, title: 'Chrome', bounds, owner: { processId: 4 } },
    ]
    const sources = native.map(window => ({ id: `window:${window.id}:0`, name: window.title }))
    const targets = matchWindowTargets(native, sources, 99, 'win32')
    expect(windowAtPoint(targets, { x: 500, y: 400 })?.label).toBe('Total Commander')
  })

  it('keeps the pre-overlay window order while refreshing target metadata', () => {
    const bounds = { x: 100, y: 100, width: 900, height: 700 }
    const chrome = { id: 'window:40:0', label: 'Chrome refreshed', bounds }
    const commander = { id: 'window:30:0', label: 'Total Commander refreshed', bounds }
    const notification = { id: 'window:50:0', label: 'New window', bounds }
    const targets = windowsInSnapshotOrder([chrome, commander, notification], [commander.id, chrome.id])
    expect(targets).toEqual([commander, chrome, notification])
    expect(windowAtPoint(targets, { x: 500, y: 400 })?.label).toBe('Total Commander refreshed')
  })
})
