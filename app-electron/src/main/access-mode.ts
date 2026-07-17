import type { AccessMode, StartupAccessMode } from '../shared/contracts'
import { accessMode } from '../shared/access-mode'
import type { AppState } from './app-state'
import type { ElectronControlService } from './control-service'

export class AccessModeController {
  constructor(private appState: AppState, private control: ElectronControlService) {}

  getMode(): AccessMode {
    return accessMode({ stopped: this.appState.isStopped(), armed: this.control.getState().armed })
  }

  setMode(mode: AccessMode): void {
    if (mode === 'off') this.appState.setStopped(true)
    else if (mode === 'read-only') {
      this.control.disarm('manual')
      this.appState.setStopped(false)
    } else if (mode === 'interactive') {
      const wasStopped = this.appState.isStopped()
      if (wasStopped) this.appState.setStopped(false)
      try { this.control.arm() }
      catch (error) {
        if (wasStopped) this.appState.setStopped(true)
        throw error
      }
    } else
      throw new Error(`Unknown access mode: ${JSON.stringify(mode)}`)
  }
}

export function applyStartupAccessMode(appState: AppState, mode: StartupAccessMode): void {
  if (mode === 'off') appState.setStopped(true)
  else if (mode === 'read-only') appState.setStopped(false)
  else
    throw new Error(`Unknown startup access mode: ${JSON.stringify(mode)}`)
}
