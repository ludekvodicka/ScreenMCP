import { describe, expect, it, vi } from 'vitest'
import type { RawCaptureFrame, SourceSelection } from '../shared/contracts'
import { CaptureController } from './capture-controller'
import type { CaptureStream } from './capture-stream'
import type { TrustedWindowCaptureSource } from './trusted-window-capture'
import type { WindowDialogResolution, WindowDialogResolver } from './window-dialog-follower'

vi.mock('./streams', () => ({ publish: vi.fn() }))

describe('CaptureController active dialog following', () => {
  it('switches to a capturable modal and returns an atomic dialog frame and selection', async () => {
    const fixture = createFixture()
    const changes: Array<SourceSelection | null> = []
    fixture.controller.subscribe(selection => changes.push(selection))
    await fixture.controller.select(rootInput())
    fixture.setResolution(listedDialog('window:202:0', 'Confirm replace'))

    const captured = await fixture.controller.grab()

    expect(captured.frame).toMatchObject({ width: 6, height: 4 })
    expect(captured.selection).toEqual({
      captureId: 'window:202:0',
      kind: 'window',
      label: 'Total Commander › Confirm replace',
      width: 6,
      height: 4,
      captureWidth: 6,
      captureHeight: 4,
      followedFrom: { captureId: 'window:101:0', label: 'Total Commander' },
    })
    expect(changes.map(selection => selection?.captureId)).toEqual(['window:101:0', 'window:202:0'])
  })

  it('restores the retained parent after the modal closes or the setting is disabled', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution(listedDialog('window:202:0', 'Dialog'))
    await fixture.controller.grab()
    fixture.setResolution({ kind: 'root' })
    await expect(fixture.controller.refreshWindowDialog()).resolves.toMatchObject({ captureId: 'window:101:0', label: 'Total Commander' })

    fixture.setResolution(listedDialog('window:202:0', 'Dialog'))
    await fixture.controller.refreshWindowDialog()
    fixture.setEnabled(false)
    await expect(fixture.controller.refreshWindowDialog()).resolves.toMatchObject({ captureId: 'window:101:0', label: 'Total Commander' })
  })

  it('preserves the parent annotation coordinate space when it resized behind a modal', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution(listedDialog('window:202:0', 'Dialog'))
    await fixture.controller.grab()
    fixture.stream.sizes.set('window:101:0', { width: 24, height: 16 })
    fixture.setResolution({ kind: 'root' })

    const captured = await fixture.controller.grab()

    expect(captured.selection).toMatchObject({ captureId: 'window:101:0', width: 12, height: 8, captureWidth: 12, captureHeight: 8 })
    expect(captured.frame).toMatchObject({ width: 24, height: 16 })
  })

  it('captures an unlisted modal through an internal trusted source and clears it on restore', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution(unlistedDialog('window:202:0', 'Copy files'))

    await fixture.controller.grab()

    expect(fixture.controller.getSelection()).toMatchObject({ captureId: 'window:202:0', label: 'Total Commander › Copy files' })
    expect(fixture.stream.trustedStarts).toEqual([
      null,
      { kind: 'verified-unlisted-window', id: 'window:202:0', name: 'Copy files' },
    ])

    fixture.setResolution({ kind: 'root' })
    await fixture.controller.refreshWindowDialog()
    expect(fixture.stream.trustedStarts.at(-1)).toBeNull()
  })

  it('keeps the parent when direct modal startup races with closure', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())

    fixture.stream.failStarts.add('window:202:0')
    fixture.setResolution(unlistedDialog('window:202:0', 'Vanishing dialog'))
    await fixture.controller.grab()
    expect(fixture.controller.getSelection()?.captureId).toBe('window:101:0')
    expect(fixture.stream.starts).toEqual(['window:101:0', 'window:202:0', 'window:101:0'])
  })

  it('restores the prior trusted dialog when a nested modal startup fails', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution(unlistedDialog('window:202:0', 'Copy files'))
    await fixture.controller.refreshWindowDialog()
    fixture.stream.failStarts.add('window:303:0')
    fixture.setResolution(unlistedDialog('window:303:0', 'Copy options'))

    await expect(fixture.controller.refreshWindowDialog()).resolves.toMatchObject({ captureId: 'window:202:0' })

    expect(fixture.stream.starts).toEqual(['window:101:0', 'window:202:0', 'window:303:0', 'window:202:0'])
    expect(fixture.stream.trustedStarts.at(-1)).toEqual({ kind: 'verified-unlisted-window', id: 'window:202:0', name: 'Copy files' })
  })

  it('falls back to the parent when a followed dialog disappears during grab', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution(unlistedDialog('window:202:0', 'Dialog'))
    fixture.stream.failGrabs.add('window:202:0')

    const captured = await fixture.controller.grab()

    expect(captured.selection.captureId).toBe('window:101:0')
    expect(captured.frame).toMatchObject({ width: 12, height: 8 })
    expect(fixture.controller.getSelection()?.followedFrom).toBeUndefined()
  })

  it('throws for an unknown resolver outcome instead of silently choosing a source', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution({ kind: 'future' } as unknown as WindowDialogResolution)
    await expect(fixture.controller.refreshWindowDialog()).rejects.toThrow('Unknown dialog resolution')
  })

  it('throws for an unknown dialog capture target', async () => {
    const fixture = createFixture()
    await fixture.controller.select(rootInput())
    fixture.setResolution({ kind: 'dialog', capture: { kind: 'future', id: 'window:202:0' }, label: 'Dialog' } as unknown as WindowDialogResolution)
    await expect(fixture.controller.refreshWindowDialog()).rejects.toThrow('Unknown dialog capture target')
  })
})

function createFixture() {
  const stream = new FakeStream()
  let resolution: WindowDialogResolution = { kind: 'root' }
  let enabled = true
  const resolver: WindowDialogResolver = { resolve: vi.fn(() => Promise.resolve(resolution)) }
  const controller = new CaptureController(stream as unknown as CaptureStream, { followActiveDialogs: () => enabled, dialogResolver: resolver })
  return {
    controller,
    stream,
    setResolution: (next: WindowDialogResolution) => { resolution = next },
    setEnabled: (next: boolean) => { enabled = next },
  }
}

function rootInput(): Omit<SourceSelection, 'width' | 'height'> {
  return { captureId: 'window:101:0', kind: 'window', label: 'Total Commander' }
}

function listedDialog(id: string, label: string): WindowDialogResolution {
  return { kind: 'dialog', capture: { kind: 'listed', id }, label }
}

function unlistedDialog(id: string, label: string): WindowDialogResolution {
  return { kind: 'dialog', capture: { kind: 'unlisted', id }, label }
}

class FakeStream {
  starts: string[] = []
  trustedStarts: Array<TrustedWindowCaptureSource | null> = []
  failStarts = new Set<string>()
  failGrabs = new Set<string>()
  sizes = new Map([
    ['window:101:0', { width: 12, height: 8 }],
    ['window:202:0', { width: 6, height: 4 }],
  ])
  current: string | null = null

  start = vi.fn((captureId: string, trustedWindowSource?: TrustedWindowCaptureSource): Promise<{ width: number; height: number }> => {
    this.starts.push(captureId)
    this.trustedStarts.push(trustedWindowSource ? structuredClone(trustedWindowSource) : null)
    if (this.failStarts.delete(captureId)) return Promise.reject(new Error('Source vanished'))
    this.current = captureId
    const size = this.sizes.get(captureId)
    return size ? Promise.resolve({ ...size }) : Promise.reject(new Error(`Unknown fake source: ${captureId}`))
  })

  stop = vi.fn(() => { this.current = null; return Promise.resolve() })

  grabFrame = vi.fn((): Promise<RawCaptureFrame> => {
    const current = this.current
    if (!current) return Promise.reject(new Error('No fake source'))
    if (this.failGrabs.delete(current)) return Promise.reject(new Error('Source vanished during grab'))
    const size = this.sizes.get(current)
    return size ? Promise.resolve(frame(size.width, size.height)) : Promise.reject(new Error(`Unknown fake source: ${current}`))
  })
}

function frame(width: number, height: number): RawCaptureFrame {
  return { rgba: new Uint8Array(width * height * 4), width, height, capturedAt: 1, frameAgeMs: 0 }
}
