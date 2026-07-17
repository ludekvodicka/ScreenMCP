import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureState } from '../shared/contracts'
import type { AppState } from './app-state'
import { McpClients } from './mcp-clients'

afterEach(() => {
  vi.useRealTimers()
})

describe('McpClients presence', () => {
  it('expires request-only presence without destroying its identity', async () => {
    vi.useFakeTimers()
    let now = 0
    const states: CaptureState[] = []
    const appState = { setCaptureState: (state: CaptureState) => { states.push(structuredClone(state)) } } as unknown as AppState
    const clients = new McpClients(appState, { leaseMs: 100, sweepMs: 10, now: () => now })
    clients.connected('session', 'claude')
    expect(states.at(-1)).toEqual({ kind: 'connected', clients: ['claude'] })
    now = 101
    await vi.advanceTimersByTimeAsync(10)
    expect(states.at(-1)).toEqual({ kind: 'disconnected' })
    clients.activity('session', 'claude')
    expect(states.at(-1)).toEqual({ kind: 'connected', clients: ['claude'] })
    clients.dispose()
  })

  it('uses an SSE stream as primary presence and drops it on close', async () => {
    vi.useFakeTimers()
    let now = 0
    const states: CaptureState[] = []
    const appState = { setCaptureState: (state: CaptureState) => { states.push(structuredClone(state)) } } as unknown as AppState
    const clients = new McpClients(appState, { leaseMs: 100, sweepMs: 10, now: () => now })
    clients.connected('session', 'codex')
    clients.streamOpened('session', 'codex')
    now = 10_000
    await vi.advanceTimersByTimeAsync(10)
    expect(states.at(-1)).toEqual({ kind: 'connected', clients: ['codex'] })
    clients.streamClosed('session')
    expect(states.at(-1)).toEqual({ kind: 'disconnected' })
    clients.activity('session', 'codex')
    expect(states.at(-1)).toEqual({ kind: 'connected', clients: ['codex'] })
    clients.dispose()
  })

  it('deduplicates client names across sessions and cleans them independently', () => {
    const states: CaptureState[] = []
    const appState = { setCaptureState: (state: CaptureState) => { states.push(structuredClone(state)) } } as unknown as AppState
    const clients = new McpClients(appState, { leaseMs: 100 })
    clients.connected('first', 'codex')
    clients.connected('second', 'codex')
    expect(clients.names()).toEqual(['codex'])
    clients.disconnected('first')
    expect(clients.names()).toEqual(['codex'])
    clients.disconnected('second')
    expect(states.at(-1)).toEqual({ kind: 'disconnected' })
    clients.dispose()
  })
})
