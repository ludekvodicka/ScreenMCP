import { describe, expect, it, vi } from 'vitest'
import { WinInput, toAbsolute } from './win-input'

describe('WinInput', () => {
  it('normalizes negative virtual-desktop coordinates to 0..65535', () => {
    expect(toAbsolute({ x: -1920, y: 0 }, { x: -1920, y: 0, width: 4480, height: 1440 })).toEqual({ x: 0, y: 0 })
    expect(toAbsolute({ x: 2559, y: 1439 }, { x: -1920, y: 0, width: 4480, height: 1440 })).toEqual({ x: 65_535, y: 65_535 })
  })

  it('emits mouse move/down/up and unicode down/up per UTF-16 code unit', () => {
    const sent: Array<{ events: Buffer; count: number }> = []
    const input = new WinInput({ platform: 'win32', native: {
      send: (events: Buffer, count: number) => { sent.push({ events: Buffer.from(events), count }); return count },
      virtualBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      foregroundHwnd: () => 77,
      rootWindowFromPoint: () => 77,
    } })
    input.click({ x: 100, y: 200 }, { double: true })
    input.typeText('A😀')
    input.pressEnter()
    expect(sent.map(batch => batch.count)).toEqual([5, 6, 2])
    expect(sent[1]!.events.readUInt16LE(10)).toBe('A'.charCodeAt(0))
    expect(sent[1]!.events.readUInt16LE(90)).toBe('😀'.charCodeAt(0))
    expect(sent[1]!.events.readUInt16LE(170)).toBe('😀'.charCodeAt(1))
    expect(input.foregroundHwnd()).toBe(77)
  })

  it('turns a short SendInput write into injection_failed', () => {
    const send = vi.fn((_events: Buffer, count: number) => count - 1)
    const input = new WinInput({ platform: 'win32', native: { send, virtualBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }), foregroundHwnd: () => 1, rootWindowFromPoint: () => 1 } })
    expect(() => input.pressEnter()).toThrow(expect.objectContaining({ code: 'injection_failed' }))
  })

  it('throws out_of_bounds for a click point outside the virtual desktop instead of clamping', () => {
    expect(() => toAbsolute({ x: -32_000, y: -32_000 }, { x: 0, y: 0, width: 1920, height: 1080 })).toThrow(expect.objectContaining({ code: 'out_of_bounds' }))
    expect(() => toAbsolute({ x: 1920, y: 0 }, { x: 0, y: 0, width: 1920, height: 1080 })).toThrow(expect.objectContaining({ code: 'out_of_bounds' }))
  })

  it('exposes the root window under a screen point', () => {
    const input = new WinInput({ platform: 'win32', native: { send: (_e, count) => count, virtualBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }), foregroundHwnd: () => 1, rootWindowFromPoint: () => 4242 } })
    expect(input.rootWindowFromPoint({ x: 10, y: 20 })).toBe(4242)
  })
})
