import type { AppStateSnapshot } from './app-state'
import type { ControlState } from '../shared/contracts'
import type { DtoAutoUpdateStatus } from '../../../shared/electron/autoUpdate/common/autoUpdate.dto'

export type TrayVisualState = 'disconnected' | 'connected' | 'capturing' | 'armed' | 'stopped'

export type TrayUpdateAction = 'check' | 'show' | 'install' | 'none'

export interface TrayUpdateItem {
  label: string
  action: TrayUpdateAction
}

export function trayVisualState(snapshot: AppStateSnapshot, control: Pick<ControlState, 'armed'> = { armed: false }): TrayVisualState {
  if (snapshot.stopped) return 'stopped'
  else if (control.armed) return 'armed'
  else if (snapshot.captureState.kind === 'disconnected') return 'disconnected'
  else if (snapshot.captureState.kind === 'connected') return 'connected'
  else if (snapshot.captureState.kind === 'capturing') return 'capturing'
  else throw new Error(`Unknown capture state: ${JSON.stringify(snapshot.captureState)}`)
}

export function trayColor(state: TrayVisualState): string {
  if (state === 'disconnected') return '#8293a6'
  else if (state === 'connected') return '#54d5a4'
  else if (state === 'capturing') return '#ff4f6d'
  else if (state === 'armed') return '#e0a33e'
  else if (state === 'stopped') return '#a9495b'
  else throw new Error(`Unknown tray state: ${JSON.stringify(state)}`)
}

export function trayUpdateItem(status: DtoAutoUpdateStatus): TrayUpdateItem | null {
  const state = status.state
  if (state.kind === 'off') return null
  else if (state.kind === 'idle') return { label: 'Check for updates', action: 'check' }
  else if (state.kind === 'current') return { label: 'Check for updates', action: 'check' }
  else if (state.kind === 'failed') return { label: 'Update failed · check again', action: 'check' }
  else if (state.kind === 'checking') return { label: 'Checking for updates…', action: 'none' }
  else if (state.kind === 'available') return { label: `Version ${state.release.version} available…`, action: 'show' }
  else if (state.kind === 'downloading') return { label: `Downloading ${state.release.version} · ${Math.round(state.percent)}%`, action: 'none' }
  else if (state.kind === 'ready') return { label: `Restart and install ${state.release.version}`, action: 'install' }
  else if (state.kind === 'installing') return { label: `Installing ${state.release.version}…`, action: 'none' }
  else throw new Error(`Unknown update state: ${JSON.stringify(state)}`)
}
