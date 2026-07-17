import type { AccessMode } from './contracts'

export function accessMode(state: { stopped: boolean; armed: boolean }): AccessMode {
  if (state.stopped === true) return 'off'
  else if (state.stopped === false && state.armed === true) return 'interactive'
  else if (state.stopped === false && state.armed === false) return 'read-only'
  else throw new Error(`Unknown access state: ${JSON.stringify(state)}`)
}

export function accessModeLabel(mode: AccessMode): string {
  if (mode === 'off') return 'Off'
  else if (mode === 'read-only') return 'Read-only'
  else if (mode === 'interactive') return 'Interactive'
  else throw new Error(`Unknown access mode: ${JSON.stringify(mode)}`)
}
