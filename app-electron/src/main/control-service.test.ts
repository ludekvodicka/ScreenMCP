import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenMcpError } from '../../../core/mcp/src/errors'
import type { AuditEntry, SourceSelection } from '../shared/contracts'
import { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController } from './capture-controller'
import type { ElectronCaptureService } from './capture-service'
import { ElectronControlService } from './control-service'
import type { CoordinateResolver } from './coordinate-resolver'
import type { InteractiveRequestGate } from './interactive-request-service'
import type { OcrReader } from './ocr'
import type { RawElement, UiaClient } from './uia-client'
import type { WinInput } from './win-input'

vi.mock('./streams', () => ({ publish: vi.fn() }))

afterEach(() => vi.useRealTimers())

describe('ElectronControlService safety gate', () => {
  it('requires one explicit source-bound grant', async () => {
    const fixture = createFixture(monitor())
    await expect(fixture.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'control_not_armed' })
    fixture.service.arm()
    await expect(fixture.service.click('codex', { x: 10, y: 10 })).resolves.toEqual({ ok: true, method: 'coord' })
    expect(fixture.input.click).toHaveBeenCalledWith({ x: 110, y: 210 }, {})
    await fixture.service.dispose()
  })

  it('keeps a Read-only click pending, then executes the same call after approval arms the source', async () => {
    const approval = deferred<boolean>()
    const requests = { request: vi.fn(() => approval.promise) }
    const fixture = createFixture(windowSelection(), requests)
    const pending = fixture.service.click('codex', { element_ref: 's1e1' })

    await vi.waitFor(() => expect(requests.request).toHaveBeenCalledOnce())
    expect(fixture.uia.invoke).not.toHaveBeenCalled()
    fixture.service.arm()
    approval.resolve(true)

    await expect(pending).resolves.toEqual({ ok: true, method: 'uia' })
    expect(requests.request).toHaveBeenCalledWith({ client: 'codex', action: 'click', selection: windowSelection() }, undefined)
    expect(fixture.uia.invoke).toHaveBeenCalledOnce()
    await fixture.service.dispose()
  })

  it('does not inject after denial or an MCP abort while approval is pending', async () => {
    const deniedRequests = { request: vi.fn(() => Promise.resolve(false)) }
    const deniedFixture = createFixture(monitor(), deniedRequests)
    await expect(deniedFixture.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'control_not_armed' })
    expect(deniedFixture.input.click).not.toHaveBeenCalled()
    expect(deniedFixture.auditEntries.at(-1)).toMatchObject({ action: 'click', outcome: 'control_not_armed' })
    await deniedFixture.service.dispose()

    const approval = deferred<boolean>()
    const abortedRequests = { request: vi.fn(() => approval.promise) }
    const abortedFixture = createFixture(monitor(), abortedRequests)
    const abort = new AbortController()
    const pending = abortedFixture.service.click('claude', { x: 10, y: 10 }, {}, abort.signal)
    await vi.waitFor(() => expect(abortedRequests.request).toHaveBeenCalledOnce())
    abortedFixture.service.arm()
    abort.abort()
    approval.resolve(true)

    await expect(pending).rejects.toMatchObject({ code: 'capture_failed', message: 'The MCP request was cancelled before input' })
    expect(abortedFixture.input.click).not.toHaveBeenCalled()
    await abortedFixture.service.dispose()
  })

  it('never sends typed content to the request coordinator', async () => {
    const approval = deferred<boolean>()
    const requests = { request: vi.fn(() => approval.promise) }
    const fixture = createFixture(windowSelection(), requests)
    const pending = fixture.service.typeText('codex', 'secret-value', { element_ref: 's1e1' })
    await vi.waitFor(() => expect(requests.request).toHaveBeenCalledOnce())
    fixture.service.arm()
    approval.resolve(true)

    await expect(pending).resolves.toEqual({ ok: true, method: 'uia' })
    expect(JSON.stringify(requests.request.mock.calls)).not.toContain('secret-value')
    await fixture.service.dispose()
  })

  it('prompts only supported writes, never Off or read-only control tools', async () => {
    const requests = { request: vi.fn(() => Promise.resolve(false)) }
    const off = createFixture(windowSelection(), requests)
    off.appState.setStopped(true)
    await expect(off.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'capture_stopped' })
    expect(requests.request).not.toHaveBeenCalled()
    await off.service.dispose()

    const unsupported = createFixture(monitor(), requests)
    await expect(unsupported.service.typeText('codex', 'value')).rejects.toMatchObject({ code: 'element_actions_unavailable' })
    await expect(unsupported.service.click('codex', { element_ref: 's1e1' })).rejects.toMatchObject({ code: 'element_actions_unavailable' })
    await expect(unsupported.service.listElements('codex')).rejects.toMatchObject({ code: 'control_not_armed' })
    await expect(unsupported.service.readText('codex', { region: { x: 0, y: 0, width: 10, height: 10 } })).rejects.toMatchObject({ code: 'control_not_armed' })
    expect(requests.request).not.toHaveBeenCalled()
    await unsupported.service.dispose()
  })

  it('does not probe or switch a source while access is Off', async () => {
    const fixture = createFixture(windowSelection())
    fixture.appState.setStopped(true)
    await expect(fixture.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'capture_stopped' })
    expect(fixture.capture.refreshWindowDialog).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })

  it('turns off on source change and STOP, and stays on otherwise', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(monitor())
    fixture.service.arm()
    fixture.capture.change({ ...monitor(), captureId: 'screen:2:0', label: 'Other' })
    expect(fixture.service.getState().armed).toBe(false)
    fixture.service.arm()
    fixture.appState.setStopped(true)
    expect(fixture.service.getState().armed).toBe(false)
    fixture.appState.setStopped(false)
    fixture.service.arm()
    vi.advanceTimersByTime(60 * 60_000)
    expect(fixture.service.getState().armed).toBe(true)
    await fixture.service.dispose()
  })

  it('refreshes an active dialog and revokes Interactive before an effect', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.capture.refreshWindowDialog.mockImplementation(() => {
      const dialog: SourceSelection = { captureId: 'window:88:0', kind: 'window', label: 'Editor › Save as', width: 200, height: 100, followedFrom: { captureId: 'window:77:0', label: 'Editor' } }
      fixture.capture.change(dialog)
      return Promise.resolve(dialog)
    })

    await expect(fixture.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'control_not_armed' })
    expect(fixture.input.click).not.toHaveBeenCalled()
    expect(fixture.service.getState().armed).toBe(false)
    await fixture.service.dispose()
  })

  it('checks STOP after a native injection and disarms immediately', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.uia.invoke.mockImplementation(() => { fixture.appState.setStopped(true); return Promise.resolve() })
    await expect(fixture.service.click('claude', { element_ref: 's1e1' })).rejects.toMatchObject({ code: 'capture_stopped' })
    expect(fixture.service.getState().armed).toBe(false)
    expect(fixture.auditEntries.at(-1)).toMatchObject({ action: 'click', outcome: 'capture_stopped' })
    await fixture.service.dispose()
  })

  it('never writes raw typed text into the audit log', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    await expect(fixture.service.typeText('codex', 'secret-value', { element_ref: 's1e1' })).resolves.toEqual({ ok: true, method: 'uia' })
    const entry = fixture.auditEntries.at(-1)
    expect(entry).toMatchObject({ action: 'type', target: 'Save · [redacted 12 chars]', method: 'uia', outcome: 'ok' })
    expect(JSON.stringify(entry)).not.toContain('secret-value')
    await fixture.service.dispose()
  })

  it('rejects an out-of-source element before invoking it', async () => {
    const fixture = createFixture(windowSelection())
    fixture.coordinates.assertWithinSource.mockRejectedValue(new ScreenMcpError('out_of_bounds', 'outside'))
    fixture.service.arm()
    await expect(fixture.service.click('codex', { element_ref: 's1e1' })).rejects.toMatchObject({ code: 'out_of_bounds' })
    expect(fixture.uia.invoke).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })

  it('blocks a window coordinate click that would land on another window', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.input.rootWindowFromPoint.mockReturnValue(999)
    await expect(fixture.service.click('codex', { x: 10, y: 10 })).rejects.toMatchObject({ code: 'out_of_bounds' })
    expect(fixture.input.click).not.toHaveBeenCalled()
    expect(fixture.auditEntries.at(-1)).toMatchObject({ action: 'click', method: 'coord', outcome: 'out_of_bounds' })
    await fixture.service.dispose()
  })

  it('allows a window coordinate click that hits the selected window', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.input.rootWindowFromPoint.mockReturnValue(77)
    await expect(fixture.service.click('codex', { x: 10, y: 10 })).resolves.toEqual({ ok: true, method: 'coord' })
    expect(fixture.input.click).toHaveBeenCalledOnce()
    await fixture.service.dispose()
  })

  it('rejects a generation-less element ref before touching the worker', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    await expect(fixture.service.click('codex', { element_ref: 'e1' })).rejects.toMatchObject({ code: 'element_not_found' })
    expect(fixture.uia.snapshot).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })

  it('resolves the window bounds once and filters before converting element bounds', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.uia.enumerate.mockResolvedValue({
      truncated: false,
      elements: [
        { ref: 's1e1', runtimeId: [1], controlType: 50_000, role: 'button', name: 'Save', enabled: true, bounds: { x: 0, y: 0, width: 10, height: 10 } },
        { ref: 's1e2', runtimeId: [2], controlType: 50_004, role: 'edit', name: 'Name', enabled: true, bounds: { x: 0, y: 0, width: 10, height: 10 } },
      ],
    })
    const result = await fixture.service.listElements('codex', { role: 'button' })
    expect(result.elements.map(element => element.ref)).toEqual(['s1e1'])
    expect(fixture.coordinates.sourceScreenBounds).toHaveBeenCalledTimes(1)
    expect(fixture.coordinates.toPayload).toHaveBeenCalledTimes(1)
    expect(fixture.coordinates.toPayload).toHaveBeenCalledWith(expect.anything(), { x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 200, width: 100, height: 100 })
    await fixture.service.dispose()
  })

  it('does not expose a desktop UIA tree for monitor sources', async () => {
    const fixture = createFixture(monitor())
    fixture.service.arm()
    await expect(fixture.service.listElements('codex')).rejects.toMatchObject({ code: 'element_actions_unavailable' })
    expect(fixture.uia.enumerate).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })

  it('re-checks the foreground window immediately before append keystrokes', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.input.foregroundHwnd.mockReturnValue(88)

    await expect(fixture.service.typeText('codex', 'secret', { element_ref: 's1e1', append: true })).rejects.toMatchObject({ code: 'out_of_bounds' })
    expect(fixture.uia.focus).toHaveBeenCalledOnce()
    expect(fixture.input.typeText).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })

  it('re-checks the foreground window immediately before submit keystrokes', async () => {
    const fixture = createFixture(windowSelection())
    fixture.service.arm()
    fixture.input.foregroundHwnd.mockReturnValue(88)

    await expect(fixture.service.typeText('codex', 'value', { element_ref: 's1e1', submit: true })).rejects.toMatchObject({ code: 'out_of_bounds' })
    expect(fixture.input.pressEnter).not.toHaveBeenCalled()
    await fixture.service.dispose()
  })
})

function createFixture(initial: SourceSelection, interactiveRequests?: InteractiveRequestGate) {
  let selection: SourceSelection | null = initial
  const selectionListeners = new Set<(value: SourceSelection | null) => void>()
  const capture = {
    getSelection: () => selection ? structuredClone(selection) : null,
    subscribe: (listener: (value: SourceSelection | null) => void) => { selectionListeners.add(listener); return () => selectionListeners.delete(listener) },
    change: (value: SourceSelection | null) => { selection = value; for (const listener of selectionListeners) listener(value) },
    refreshWindowDialog: vi.fn(() => Promise.resolve(selection ? structuredClone(selection) : null)),
  }
  const appState = new AppState()
  const auditEntries: Array<Omit<AuditEntry, 'id' | 'timestamp'>> = []
  const audit = { append: vi.fn((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => { auditEntries.push(structuredClone(entry)); return Promise.resolve({ ...entry, id: `${auditEntries.length}`, timestamp: Date.now() }) }) }
  const uia = {
    enumerate: vi.fn((): Promise<{ elements: RawElement[]; truncated: boolean }> => Promise.resolve({ elements: [], truncated: false })),
    snapshot: vi.fn(() => Promise.resolve({ ref: 's1e1', runtimeId: [1], controlType: 50_000, role: 'button', name: 'Save', enabled: true, bounds: { x: 120, y: 220, width: 40, height: 20 } })),
    invoke: vi.fn(() => Promise.resolve()),
    getValue: vi.fn(() => Promise.resolve('Save')),
    setValue: vi.fn(() => Promise.resolve()),
    focus: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(() => Promise.resolve()),
  }
  const input = { click: vi.fn(), typeText: vi.fn(), pressEnter: vi.fn(), foregroundHwnd: vi.fn(() => 77), rootWindowFromPoint: vi.fn(() => 77) }
  const ocr = { readRegion: vi.fn(() => Promise.resolve({ text: 'Save', words: [], method: 'ocr' as const })), dispose: vi.fn(() => Promise.resolve()) }
  const coordinates = {
    toScreen: vi.fn(() => Promise.resolve({ x: 110, y: 210 })),
    toPayload: vi.fn(() => Promise.resolve({ x: 10, y: 10, width: 20, height: 20 })),
    assertPayloadRect: vi.fn(),
    assertWithinSource: vi.fn(() => Promise.resolve()),
    sourceScreenBounds: vi.fn(() => Promise.resolve({ x: 100, y: 200, width: 100, height: 100 })),
  }
  const captureService = { controlFrame: vi.fn() }
  const service = new ElectronControlService(
    capture as unknown as CaptureController,
    captureService as unknown as ElectronCaptureService,
    appState,
    audit as unknown as AuditLog,
    uia as unknown as UiaClient,
    input as unknown as WinInput,
    ocr as unknown as OcrReader,
    coordinates as unknown as CoordinateResolver,
    { platform: 'win32', interactiveRequests },
  )
  return { service, capture, appState, auditEntries, uia, input, ocr, coordinates }
}

function monitor(): SourceSelection {
  return { captureId: 'screen:1:0', kind: 'monitor', label: 'Monitor', width: 100, height: 100, captureWidth: 100, captureHeight: 100 }
}

function windowSelection(): SourceSelection {
  return { captureId: 'window:77:0', kind: 'window', label: 'Editor', width: 100, height: 100, captureWidth: 100, captureHeight: 100 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
