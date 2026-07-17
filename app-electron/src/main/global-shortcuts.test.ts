import { describe, expect, it, vi } from 'vitest'
import type { PickerMode } from '../shared/contracts'
import { GlobalShortcuts, type ShortcutRegistrar } from './global-shortcuts'

vi.mock('electron', () => ({ globalShortcut: {} }))

function fakeRegistrar(failing: string[] = []) {
  const callbacks = new Map<string, () => void>()
  const unregistered: string[] = []
  const registrar: ShortcutRegistrar = {
    register(accelerator, callback) {
      if (failing.includes(accelerator)) return false
      callbacks.set(accelerator, callback)
      return true
    },
    unregister(accelerator) {
      unregistered.push(accelerator)
      callbacks.delete(accelerator)
    },
  }
  return { registrar, callbacks, unregistered }
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('GlobalShortcuts', () => {
  it('registers configured accelerators and reports per-action status', () => {
    const { registrar } = fakeRegistrar(['Shift+Scrolllock'])
    const shortcuts = new GlobalShortcuts(() => Promise.resolve(), () => true, () => {}, registrar)
    const status = shortcuts.apply({ pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' })
    expect(status).toEqual({ pickRegion: 'active', pickWindow: 'unavailable' })
  })

  it('treats null as disabled and does not register it', () => {
    const { registrar, callbacks } = fakeRegistrar()
    const shortcuts = new GlobalShortcuts(() => Promise.resolve(), () => true, () => {}, registrar)
    expect(shortcuts.apply({ pickRegion: null, pickWindow: 'F19' })).toEqual({ pickRegion: 'off', pickWindow: 'active' })
    expect([...callbacks.keys()]).toEqual(['F19'])
  })

  it('re-applying unregisters the previous accelerators first', () => {
    const { registrar, callbacks, unregistered } = fakeRegistrar()
    const shortcuts = new GlobalShortcuts(() => Promise.resolve(), () => true, () => {}, registrar)
    shortcuts.apply({ pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' })
    shortcuts.apply({ pickRegion: 'F13', pickWindow: null })
    expect(unregistered).toEqual(['Scrolllock', 'Shift+Scrolllock'])
    expect([...callbacks.keys()]).toEqual(['F13'])
    shortcuts.dispose()
    expect(callbacks.size).toBe(0)
    expect(shortcuts.status()).toEqual({ pickRegion: 'off', pickWindow: 'off' })
  })

  it('marks an accelerator the registrar rejects as unavailable', () => {
    const registrar: ShortcutRegistrar = { register: () => { throw new Error('invalid accelerator') }, unregister: () => {} }
    const shortcuts = new GlobalShortcuts(() => Promise.resolve(), () => true, () => {}, registrar)
    expect(shortcuts.apply({ pickRegion: 'Bogus', pickWindow: null })).toEqual({ pickRegion: 'unavailable', pickWindow: 'off' })
  })

  it('triggers the matching picker mode from the key handler', async () => {
    const { registrar, callbacks } = fakeRegistrar()
    const picks: PickerMode[] = []
    const shortcuts = new GlobalShortcuts(mode => { picks.push(mode); return Promise.resolve() }, () => true, () => {}, registrar)
    shortcuts.apply({ pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' })
    callbacks.get('Scrolllock')!()
    callbacks.get('Shift+Scrolllock')!()
    await flush()
    expect(picks).toEqual(['rectangle', 'window'])
  })

  it('shows the window instead of picking when capture is unavailable', () => {
    const { registrar, callbacks } = fakeRegistrar()
    const pick = vi.fn(() => Promise.resolve())
    const onUnavailable = vi.fn()
    const shortcuts = new GlobalShortcuts(pick, () => false, onUnavailable, registrar)
    shortcuts.apply({ pickRegion: 'Scrolllock', pickWindow: null })
    callbacks.get('Scrolllock')!()
    expect(pick).not.toHaveBeenCalled()
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('ignores a press while a picker session is already open but surfaces other failures', async () => {
    const { registrar, callbacks } = fakeRegistrar()
    const onUnavailable = vi.fn()
    let rejection = new Error('Another source picker is already open')
    const shortcuts = new GlobalShortcuts(() => Promise.reject(rejection), () => true, onUnavailable, registrar)
    shortcuts.apply({ pickRegion: 'Scrolllock', pickWindow: null })
    callbacks.get('Scrolllock')!()
    await flush()
    expect(onUnavailable).not.toHaveBeenCalled()
    rejection = new Error('Desktop overlays are unavailable on Wayland; use the system portal picker')
    callbacks.get('Scrolllock')!()
    await flush()
    expect(onUnavailable).toHaveBeenCalledOnce()
  })
})
