import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { hashDistance } from '../../../core/capture/src/dhash'
import { isNearlyBlack } from '../../../core/capture/src/encode'
import { drawHighlights } from '../../../core/capture/src/highlights'
import type { PreparedFrame } from '../../../core/capture/src/types'
import type { HighlightRect, SourceSelection } from '../shared/contracts'
import type { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController, CaptureSnapshot } from './capture-controller'
import { ElectronCaptureService, highlightStrokeWidth, mixHighlightFingerprint, type CaptureFramePipeline } from './capture-service'
import type { McpClients } from './mcp-clients'
import type { SettingsStore } from './settings-store'

describe('ElectronCaptureService redaction', () => {
  it('blocks source metadata and local preview while access is Off', async () => {
    const selection: SourceSelection = { captureId: 'screen:1', kind: 'monitor', label: 'Monitor', width: 100, height: 100 }
    const service = new ElectronCaptureService(
      { getSelection: () => selection } as unknown as CaptureController,
      { framePolicy: () => ({ format: 'jpeg', jpegQuality: 80, maxLongSide: 1568 }), masks: () => [{ id: 'secret', x: 1, y: 1, width: 2, height: 2 }], highlights: () => [{ id: 'label', shape: 'rect', label: 'salary row', x: 3, y: 3, width: 4, height: 4 }] } as unknown as SettingsStore,
      { isStopped: () => true } as unknown as AppState,
      {} as AuditLog,
      {} as McpClients,
    )

    await expect(service.describeSource()).rejects.toThrow('access mode is Off')
    await expect(service.preview()).rejects.toThrow('access mode is Off')
  })

  it('uses the same masked pixels for look, resource, hash, and audit thumbnail', async () => {
    const selection = { captureId: 'screen:1', kind: 'monitor' as const, label: 'Monitor', width: 20, height: 10 }
    const rgba = new Uint8Array(20 * 10 * 4).fill(255)
    const thumbnails: Buffer[] = []
    const capture = {
      getSelection: () => structuredClone(selection),
      grab: () => Promise.resolve({ frame: { rgba: rgba.slice(), width: 20, height: 10, capturedAt: 1, frameAgeMs: 0 }, selection: structuredClone(selection) }),
      refreshWindowDialog: () => Promise.resolve(structuredClone(selection)),
    } as unknown as CaptureController
    const settings = {
      get: () => ({ hashThreshold: 0 }),
      framePolicy: () => ({ format: 'png' as const, jpegQuality: 80, maxLongSide: null }),
      masks: () => [{ id: 'secret', x: 5, y: 0, width: 10, height: 10 }],
      highlights: () => [],
    } as unknown as SettingsStore
    const audit = {
      append: (_entry: unknown, thumbnail?: Buffer) => { if (thumbnail) thumbnails.push(thumbnail); return Promise.resolve(undefined) },
    } as unknown as AuditLog
    const appState = { isStopped: () => false } as unknown as AppState
    const clients = { noteLook: () => undefined } as unknown as McpClients
    const service = new ElectronCaptureService(capture, settings, appState, audit, clients)

    const look = await service.look('codex')
    if (!look.changed) throw new Error('Expected changed look')
    const lookPixels = await sharp(look.data).raw().toBuffer({ resolveWithObject: true })
    expect(pixel(lookPixels.data, 20, lookPixels.info.channels, 10, 5)).toEqual([0, 0, 0])
    expect(pixel(lookPixels.data, 20, lookPixels.info.channels, 2, 5)).toEqual([255, 255, 255])

    const resource = await service.readCurrent('codex')
    const resourcePixels = await sharp(resource.data).raw().toBuffer({ resolveWithObject: true })
    expect(pixel(resourcePixels.data, 20, resourcePixels.info.channels, 10, 5)).toEqual([0, 0, 0])
    expect(resource.hash).toBe(look.hash)

    expect(thumbnails).toHaveLength(2)
    const thumbnailPixels = await sharp(thumbnails[0]).raw().toBuffer({ resolveWithObject: true })
    expect(pixel(thumbnailPixels.data, 20, thumbnailPixels.info.channels, 10, 5).every(channel => channel < 20)).toBe(true)
    expect((await service.describeSource()).masks).toBe(1)
    expect((await service.describeSource()).highlights).toEqual([])
  })

  it('keeps preview redaction aligned when a captured window changes size', async () => {
    const selection: SourceSelection = { captureId: 'window:1:0', kind: 'window', label: 'Resizable window', width: 20, height: 10 }
    const capture = {
      getSelection: () => structuredClone(selection),
      grab: () => Promise.resolve({ frame: { rgba: new Uint8Array(40 * 20 * 4).fill(255), width: 40, height: 20, capturedAt: 1, frameAgeMs: 0 }, selection: structuredClone(selection) }),
    } as unknown as CaptureController
    const settings = {
      framePolicy: () => ({ format: 'png' as const, jpegQuality: 80, maxLongSide: null }),
      masks: () => [{ id: 'secret', x: 5, y: 2, width: 10, height: 4 }],
      highlights: () => [],
    } as unknown as SettingsStore
    const service = new ElectronCaptureService(
      capture,
      settings,
      { isStopped: () => false } as unknown as AppState,
      { append: () => Promise.resolve(undefined) } as unknown as AuditLog,
      { noteLook: () => undefined } as unknown as McpClients,
    )

    const preview = await service.preview()
    if (!preview) throw new Error('Expected preview frame')
    expect(preview).toMatchObject({ sourceWidth: 40, sourceHeight: 20, width: 40, height: 20, format: 'png' })
    const decoded = await sharp(Buffer.from(preview.dataUrl.split(',')[1]!, 'base64')).raw().toBuffer({ resolveWithObject: true })
    expect(pixel(decoded.data, 40, decoded.info.channels, 12, 6)).toEqual([0, 0, 0])
    expect(pixel(decoded.data, 40, decoded.info.channels, 6, 3)).toEqual([255, 255, 255])
  })

  it('uses the atomic followed selection returned with the captured frame', async () => {
    const root: SourceSelection = { captureId: 'window:1:0', kind: 'window', label: 'Parent', width: 20, height: 10 }
    const dialog: SourceSelection = { captureId: 'window:2:0', kind: 'window', label: 'Parent › Dialog', width: 4, height: 2, followedFrom: { captureId: root.captureId, label: root.label } }
    const masks = vi.fn(() => [])
    const append = vi.fn(() => Promise.resolve(undefined))
    const service = new ElectronCaptureService(
      {
        getSelection: () => structuredClone(root),
        grab: () => Promise.resolve({ frame: { rgba: new Uint8Array(4 * 2 * 4).fill(255), width: 4, height: 2, capturedAt: 1, frameAgeMs: 0 }, selection: structuredClone(dialog) }),
      } as unknown as CaptureController,
      {
        get: () => ({ hashThreshold: 0 }),
        framePolicy: () => ({ format: 'png' as const, jpegQuality: 80, maxLongSide: null }),
        masks,
        highlights: () => [],
      } as unknown as SettingsStore,
      { isStopped: () => false } as unknown as AppState,
      { append } as unknown as AuditLog,
      { noteLook: () => undefined } as unknown as McpClients,
    )

    const look = await service.look('codex')
    if (!look.changed) throw new Error('Expected changed look')
    expect(look.source).toEqual({ kind: 'window', label: 'Parent › Dialog' })
    expect(look).toMatchObject({ width: 4, height: 2 })
    expect(masks).toHaveBeenCalledWith(dialog)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ source: 'Parent › Dialog', sourceKind: 'window' }), expect.any(Buffer))
  })

  it('does not encode an unchanged look', async () => {
    const context = serviceContext(['0123456789abcdef'])
    const result = await context.service.look('codex', '0123456789abcdef')
    expect(result).toEqual({ changed: false, hash: '0123456789abcdef' })
    expect(context.frames.encode).not.toHaveBeenCalled()
    expect(context.noteLook).not.toHaveBeenCalled()
  })

  it('burns scaled highlights after masks and publishes matching output-pixel metadata', async () => {
    const selection: SourceSelection = { captureId: 'window:2:0', kind: 'window', label: 'Resizable window', width: 100, height: 100 }
    const highlight: HighlightRect = { id: 'save', shape: 'rect', label: 'save button', x: 10, y: 40, width: 50, height: 40 }
    const capture = {
      getSelection: () => structuredClone(selection),
      grab: () => Promise.resolve({ frame: { rgba: new Uint8Array(200 * 200 * 4).fill(255), width: 200, height: 200, capturedAt: 1, frameAgeMs: 0 }, selection: structuredClone(selection) }),
      refreshWindowDialog: () => Promise.resolve(structuredClone(selection)),
    } as unknown as CaptureController
    const settings = {
      get: () => ({ hashThreshold: 0 }),
      framePolicy: () => ({ format: 'png' as const, jpegQuality: 80, maxLongSide: 100 }),
      masks: () => [{ id: 'secret', x: 25, y: 50, width: 15, height: 15 }],
      highlights: () => [highlight],
    } as unknown as SettingsStore
    const service = new ElectronCaptureService(
      capture,
      settings,
      { isStopped: () => false } as unknown as AppState,
      { append: () => Promise.resolve(undefined) } as unknown as AuditLog,
      { noteLook: () => undefined } as unknown as McpClients,
    )

    const look = await service.look('codex')
    if (!look.changed) throw new Error('Expected changed look')
    expect(look.highlights).toEqual([{ n: 1, shape: 'rect', label: 'save button', x: 10, y: 40, width: 50, height: 40 }])
    const decoded = await sharp(look.data).raw().toBuffer({ resolveWithObject: true })
    expect(pixel(decoded.data, 100, decoded.info.channels, 30, 55)).toEqual([0, 0, 0])
    const stroke = pixel(decoded.data, 100, decoded.info.channels, 9, 55)
    expect(stroke[0]).toBeGreaterThan(230)
    expect(stroke[1]).toBeGreaterThan(190)
    expect(stroke[2]).toBeLessThan(20)
    expect(await service.describeSource()).toMatchObject({ masks: 1, highlights: [{ n: 1, shape: 'rect', label: 'save button', x: 10, y: 40, width: 50, height: 40 }] })
  })

  it('compensates stroke width and mixes only non-empty highlight sets into the hash', () => {
    const first: HighlightRect[] = [{ id: 'one', shape: 'rect', x: 1, y: 2, width: 3, height: 4 }]
    const second: HighlightRect[] = [{ ...first[0]!, label: 'changed' }]
    const hash = '0123456789abcdef'
    const mixed = mixHighlightFingerprint(hash, first)

    expect(highlightStrokeWidth(200, 100, 100)).toBe(6)
    expect(highlightStrokeWidth(200, 100, null)).toBe(3)
    expect(mixHighlightFingerprint(hash, [])).toBe(hash)
    expect(mixHighlightFingerprint(hash, first)).toBe(mixed)
    expect(hashDistance(mixed, mixHighlightFingerprint(hash, second))).toBeGreaterThan(4)
  })

  it('keeps a black frame nearly-black after a typical highlight', () => {
    const rgba = new Uint8Array(1_000 * 1_000 * 4)
    drawHighlights(rgba, 1_000, 1_000, [{ id: 'one', shape: 'rect', x: 300, y: 400, width: 300, height: 200 }], 3)
    expect(isNearlyBlack(rgba)).toBe(true)
  })

  it('returns unchanged highlight metadata for a static set without encoding', async () => {
    const context = serviceContext(['0123456789abcdef', '0123456789abcdef'])
    context.setHighlights([{ id: 'one', shape: 'rect', label: 'target', x: 0, y: 0, width: 1, height: 1 }])
    const first = await context.service.look('codex')
    if (!first.changed) throw new Error('Expected changed look')
    const second = await context.service.look('codex', first.hash)

    expect(second).toEqual({ changed: false, hash: first.hash, highlights: [{ n: 1, shape: 'rect', label: 'target', x: 0, y: 0, width: 1, height: 1 }] })
    expect(context.frames.encode).toHaveBeenCalledTimes(1)
  })

  it('compares wait samples with one baseline and encodes only the change', async () => {
    vi.useFakeTimers()
    try {
      const context = serviceContext(['0000000000000000', '0000000000000001', '0000000000000003'], 1)
      const pending = context.service.waitForChange('codex', 2_000)
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await pending
      expect(result).toMatchObject({ changed: true, hash: '0000000000000003' })
      expect(context.frames.prepare).toHaveBeenCalledTimes(3)
      expect(context.frames.encode).toHaveBeenCalledTimes(1)
      expect(context.noteLook).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('wakes wait_for_change when a highlight changes over an identical frame', async () => {
    vi.useFakeTimers()
    try {
      const context = serviceContext(['0000000000000000', '0000000000000000'], 4)
      const pending = context.service.waitForChange('codex', 2_000)
      await vi.waitFor(() => expect(context.frames.prepare).toHaveBeenCalledTimes(1))
      context.setHighlights([{ id: 'one', shape: 'rect', x: 0, y: 0, width: 1, height: 1 }])
      await vi.advanceTimersByTimeAsync(500)
      const result = await pending

      expect(result).toMatchObject({ changed: true, highlights: [{ n: 1, shape: 'rect' }] })
      expect(context.frames.encode).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards an in-flight grab after STOP', async () => {
    let release: ((snapshot: CaptureSnapshot) => void) | undefined
    const context = serviceContext(['0000000000000000'])
    context.capture.grab = vi.fn(() => new Promise<CaptureSnapshot>(resolve => { release = resolve }))
    const pending = context.service.look('codex')
    await vi.waitFor(() => expect(context.capture.grab).toHaveBeenCalledTimes(1))
    context.appState.setStopped(true)
    release?.({ frame: { rgba: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, capturedAt: 1, frameAgeMs: 0 }, selection: { captureId: 'window:1:0', kind: 'window', label: 'Editor', width: 1, height: 1 } })
    await expect(pending).rejects.toThrow('access mode is Off')
    expect(context.frames.prepare).not.toHaveBeenCalled()
    expect(context.frames.encode).not.toHaveBeenCalled()
  })

  it('wakes a pending wait immediately on STOP without flashing', async () => {
    const context = serviceContext(['0000000000000000'])
    const pending = context.service.waitForChange('codex', 30_000)
    await vi.waitFor(() => expect(context.frames.prepare).toHaveBeenCalledTimes(1))
    context.appState.setStopped(true)
    await expect(pending).rejects.toThrow('access mode is Off')
    expect(context.frames.encode).not.toHaveBeenCalled()
    expect(context.noteLook).not.toHaveBeenCalled()
  })
})

function serviceContext(hashes: string[], hashThreshold = 0) {
  const selection: SourceSelection = { captureId: 'window:1:0', kind: 'window', label: 'Editor', width: 1, height: 1 }
  const capture = {
    getSelection: vi.fn(() => structuredClone(selection)),
    grab: vi.fn<() => Promise<CaptureSnapshot>>(() => Promise.resolve({ frame: { rgba: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, capturedAt: 1, frameAgeMs: 0 }, selection: structuredClone(selection) })),
    refreshWindowDialog: vi.fn(() => Promise.resolve(structuredClone(selection))),
  }
  let highlights: HighlightRect[] = []
  const settings = {
    get: vi.fn(() => ({ hashThreshold })),
    framePolicy: vi.fn(() => ({ format: 'png' as const, jpegQuality: 80, maxLongSide: null })),
    masks: vi.fn(() => []),
    highlights: vi.fn(() => structuredClone(highlights)),
  }
  const audit = { append: vi.fn(() => Promise.resolve(undefined)) }
  const appState = new TestAppState()
  const noteLook = vi.fn()
  const clients = { noteLook }
  let lastHash = hashes.at(-1) ?? '0000000000000000'
  const prepare = vi.fn<CaptureFramePipeline['prepare']>((raw) => {
    lastHash = hashes.shift() ?? lastHash
    return Promise.resolve({ rgba: raw.rgba, width: raw.width, height: raw.height, hash: lastHash, capturedAt: raw.capturedAt, frameAgeMs: raw.frameAgeMs, nearlyBlack: false })
  })
  const encode = vi.fn<CaptureFramePipeline['encode']>(async (frame: PreparedFrame, policy) => ({
      ...frame,
      data: await sharp(Buffer.from(frame.rgba), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer(),
      format: policy.format,
    }))
  const frames: CaptureFramePipeline = { prepare, encode }
  return {
    service: new ElectronCaptureService(capture as unknown as CaptureController, settings as unknown as SettingsStore, appState as unknown as AppState, audit as unknown as AuditLog, clients as unknown as McpClients, frames),
    capture,
    appState,
    frames: { prepare, encode },
    noteLook,
    setHighlights: (next: HighlightRect[]) => { highlights = structuredClone(next) },
  }
}

class TestAppState {
  private stopped = false
  private listeners = new Set<(snapshot: { stopped: boolean; captureState: { kind: 'disconnected' } }) => void>()

  isStopped(): boolean { return this.stopped }

  setStopped(stopped: boolean): void {
    this.stopped = stopped
    for (const listener of this.listeners) listener({ stopped, captureState: { kind: 'disconnected' } })
  }

  subscribe(listener: (snapshot: { stopped: boolean; captureState: { kind: 'disconnected' } }) => void): () => void {
    this.listeners.add(listener)
    listener({ stopped: this.stopped, captureState: { kind: 'disconnected' } })
    return () => this.listeners.delete(listener)
  }
}

function pixel(data: Buffer, width: number, channels: number, x: number, y: number): number[] {
  const offset = (y * width + x) * channels
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!]
}
