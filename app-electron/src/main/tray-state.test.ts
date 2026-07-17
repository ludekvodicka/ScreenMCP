import { describe, expect, it } from 'vitest'
import { trayColor, trayVisualState, type TrayVisualState } from './tray-state'

describe('tray state', () => {
  it.each([
    [{ stopped: false, captureState: { kind: 'disconnected' as const } }, 'disconnected'],
    [{ stopped: false, captureState: { kind: 'connected' as const, clients: ['codex'] } }, 'connected'],
    [{ stopped: false, captureState: { kind: 'capturing' as const, clients: ['codex'] } }, 'capturing'],
    [{ stopped: true, captureState: { kind: 'capturing' as const, clients: ['codex'] } }, 'stopped'],
  ] satisfies Array<[Parameters<typeof trayVisualState>[0], TrayVisualState]>)('maps %j to %s', (snapshot, expected) => {
    expect(trayVisualState(snapshot)).toBe(expected)
  })

  it('shows interactive above capture while STOP remains authoritative', () => {
    const snapshot = { stopped: false, captureState: { kind: 'capturing' as const, clients: ['codex'] } }
    expect(trayVisualState(snapshot, { armed: true })).toBe('armed')
    expect(trayVisualState({ ...snapshot, stopped: true }, { armed: true })).toBe('stopped')
  })

  it('assigns a distinct color to every state', () => {
    expect(new Set((['disconnected', 'connected', 'capturing', 'armed', 'stopped'] satisfies TrayVisualState[]).map(trayColor)).size).toBe(5)
  })
})
