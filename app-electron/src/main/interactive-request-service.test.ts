import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceSelection } from '../shared/contracts'
import { AppState } from './app-state'
import type { CaptureController } from './capture-controller'
import { InteractiveRequestService } from './interactive-request-service'

vi.mock('./streams', () => ({ publish: vi.fn() }))

afterEach(() => vi.useRealTimers())

describe('InteractiveRequestService', () => {
  it('reveals one request and releases it only after Interactive is enabled', async () => {
    const fixture = createFixture()
    const order: string[] = []
    const pending = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection() }).then(allowed => { order.push(`resolved:${allowed}`); return allowed })
    const request = fixture.service.listPending()[0]
    if (!request) throw new Error('Expected one pending request')

    expect(request).toMatchObject({ client: 'codex', action: 'click', source: 'Editor' })
    expect(fixture.reveal).toHaveBeenCalledOnce()
    await fixture.service.respond(request.id, 'enable-interactive', () => order.push('enabled'))

    await expect(pending).resolves.toBe(true)
    expect(order).toEqual(['enabled', 'resolved:true'])
    expect(fixture.restore).toHaveBeenCalledOnce()
    expect(fixture.service.listPending()).toEqual([])
    await fixture.service.dispose()
  })

  it('keeps Read-only on denial and timeout', async () => {
    vi.useFakeTimers()
    const fixture = createFixture(100)
    const denied = fixture.service.request({ client: 'codex', action: 'type_text', selection: windowSelection() })
    const first = fixture.service.listPending()[0]
    if (!first) throw new Error('Expected one pending request')
    await fixture.service.respond(first.id, 'keep-read-only', vi.fn())
    await expect(denied).resolves.toBe(false)

    const timedOut = fixture.service.request({ client: 'claude', action: 'click', selection: windowSelection() })
    await vi.advanceTimersByTimeAsync(100)
    await expect(timedOut).resolves.toBe(false)
    expect(fixture.service.listPending()).toEqual([])
    await fixture.service.dispose()
  })

  it('coalesces concurrent writes while keeping each abort signal independent', async () => {
    const fixture = createFixture()
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection() }, firstAbort.signal)
    const second = fixture.service.request({ client: 'claude', action: 'type_text', selection: windowSelection() }, secondAbort.signal)
    const id = fixture.service.listPending()[0]?.id
    if (!id) throw new Error('Expected one pending request')

    expect(fixture.reveal).toHaveBeenCalledOnce()
    firstAbort.abort()
    await expect(first).resolves.toBe(false)
    expect(fixture.service.listPending()).toEqual([{ id, client: 'claude', action: 'type_text', source: 'Editor' }])

    await fixture.service.respond(id, 'enable-interactive', vi.fn())
    await expect(second).resolves.toBe(true)
    await fixture.service.dispose()
  })

  it('dismisses the request when its last waiter aborts and rejects a stale response', async () => {
    const fixture = createFixture()
    const abort = new AbortController()
    const pending = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection() }, abort.signal)
    const id = fixture.service.listPending()[0]?.id
    if (!id) throw new Error('Expected one pending request')

    abort.abort()
    await expect(pending).resolves.toBe(false)
    await vi.waitFor(() => expect(fixture.restore).toHaveBeenCalledOnce())
    expect(fixture.service.listPending()).toEqual([])
    await expect(fixture.service.respond(id, 'enable-interactive', vi.fn())).rejects.toThrow('expired')
    await fixture.service.dispose()
  })

  it('cancels synchronously on source change and Off', async () => {
    const fixture = createFixture()
    const sourceChanged = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection() })
    fixture.capture.change(windowSelection('window:88:0'))
    await expect(sourceChanged).resolves.toBe(false)
    expect(fixture.service.listPending()).toEqual([])

    const stopped = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection('window:88:0') })
    fixture.appState.setStopped(true)
    await expect(stopped).resolves.toBe(false)
    expect(fixture.service.listPending()).toEqual([])
    await fixture.service.dispose()
  })

  it('keeps the prompt pending when the Interactive transition fails', async () => {
    const fixture = createFixture()
    const pending = fixture.service.request({ client: 'codex', action: 'click', selection: windowSelection() })
    const id = fixture.service.listPending()[0]?.id
    if (!id) throw new Error('Expected one pending request')

    await expect(fixture.service.respond(id, 'enable-interactive', () => { throw new Error('cannot arm') })).rejects.toThrow('cannot arm')
    expect(fixture.service.listPending()).toHaveLength(1)
    await fixture.service.respond(id, 'keep-read-only', vi.fn())
    await expect(pending).resolves.toBe(false)
    await fixture.service.dispose()
  })
})

function createFixture(timeoutMs = 120_000) {
  let selection: SourceSelection | null = windowSelection()
  const listeners = new Set<(selection: SourceSelection | null) => void>()
  const capture = {
    getSelection: () => selection ? structuredClone(selection) : null,
    subscribe: (listener: (next: SourceSelection | null) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    change: (next: SourceSelection | null) => { selection = next; for (const listener of listeners) listener(next) },
  }
  const appState = new AppState()
  const restore = vi.fn(() => Promise.resolve())
  const reveal = vi.fn(() => ({ restore }))
  const service = new InteractiveRequestService(capture as unknown as CaptureController, appState, { timeoutMs, reveal })
  return { service, capture, appState, restore, reveal }
}

function windowSelection(captureId = 'window:77:0'): SourceSelection {
  return { captureId, kind: 'window', label: 'Editor', width: 100, height: 100, captureWidth: 100, captureHeight: 100 }
}
