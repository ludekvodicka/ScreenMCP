import { globalShortcut } from 'electron'
import type { PickerMode, ShortcutAction, ShortcutSettings, ShortcutStatus } from '../shared/contracts'

export interface ShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['pickRegion', 'pickWindow']

function pickerMode(action: ShortcutAction): PickerMode {
  if (action === 'pickRegion') return 'rectangle'
  else if (action === 'pickWindow') return 'window'
  else throw new Error(`Unknown shortcut action: ${JSON.stringify(action)}`)
}

export class GlobalShortcuts {
  private registered = new Map<ShortcutAction, string>()
  private state: ShortcutStatus = { pickRegion: 'off', pickWindow: 'off' }

  constructor(
    private pick: (mode: PickerMode) => Promise<unknown>,
    private canPick: () => boolean,
    private onUnavailable: () => void,
    private registrar: ShortcutRegistrar = globalShortcut,
  ) {}

  apply(shortcuts: ShortcutSettings): ShortcutStatus {
    this.unregisterAll()
    for (const action of SHORTCUT_ACTIONS) {
      const accelerator = shortcuts[action]
      if (!accelerator) { this.state[action] = 'off'; continue }
      let ok: boolean
      // register throws on malformed accelerators and returns false when another app holds the key
      try { ok = this.registrar.register(accelerator, () => this.trigger(pickerMode(action))) } catch { ok = false }
      if (ok) this.registered.set(action, accelerator)
      this.state[action] = ok ? 'active' : 'unavailable'
    }
    return this.status()
  }

  status(): ShortcutStatus {
    return { ...this.state }
  }

  dispose(): void {
    this.unregisterAll()
    this.state = { pickRegion: 'off', pickWindow: 'off' }
  }

  private unregisterAll(): void {
    for (const accelerator of this.registered.values()) this.registrar.unregister(accelerator)
    this.registered.clear()
  }

  private trigger(mode: PickerMode): void {
    if (!this.canPick()) { this.onUnavailable(); return }
    void this.pick(mode).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      // a picker session is already on screen — the shortcut is simply a no-op
      if (message.includes('already open')) return
      this.onUnavailable()
    })
  }
}
