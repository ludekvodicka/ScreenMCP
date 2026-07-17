import type { AppStateSnapshot } from './app-state'
import type { ControlState } from '../shared/contracts'

export type TrayVisualState = 'disconnected' | 'connected' | 'capturing' | 'armed' | 'stopped'

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
