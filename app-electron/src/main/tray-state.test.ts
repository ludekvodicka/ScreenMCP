import { describe, expect, it } from 'vitest'
import type { AutoUpdateState, DtoAutoUpdateStatus } from '../../../shared/electron/autoUpdate/common/autoUpdate.dto'
import { trayColor, trayUpdateItem, trayVisualState, type TrayVisualState } from './tray-state'

const release = { version: '0.2.0', name: null, date: null, notes: null }

function updateStatus(state: AutoUpdateState): DtoAutoUpdateStatus {
  return { running: '0.1.0', mode: 'automatic', releasePage: true, state }
}

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

  it('offers Restart and install only for a ready update and locks it while installing', () => {
    expect(trayUpdateItem(updateStatus({ kind: 'ready', release }))).toEqual({ label: 'Restart and install 0.2.0', action: 'install' })
    expect(trayUpdateItem(updateStatus({ kind: 'installing', release }))).toEqual({ label: 'Installing 0.2.0…', action: 'none' })
    expect(trayUpdateItem(updateStatus({ kind: 'downloading', release, percent: 41.6, transferred: 1, total: 2, bytesPerSecond: 1 }))).toEqual({ label: 'Downloading 0.2.0 · 42%', action: 'none' })
    expect(trayUpdateItem(updateStatus({ kind: 'current', checkedAt: 1 }))?.action).toBe('check')
    expect(trayUpdateItem(updateStatus({ kind: 'failed', message: 'offline', release: null }))?.action).toBe('check')
  })

  it('hides the update item when updates are off', () => {
    expect(trayUpdateItem({ ...updateStatus({ kind: 'off', reason: 'Development run' }), mode: 'off' })).toBeNull()
  })
})
