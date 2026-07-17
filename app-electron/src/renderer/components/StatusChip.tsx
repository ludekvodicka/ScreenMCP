import type { CaptureState } from '../../shared/contracts'

interface Props {
  state: CaptureState
  stopped: boolean
}

export function StatusChip({ state, stopped }: Props) {
  if (stopped) return <span className="status-chip status-stopped"><i />Serving stopped</span>
  if (state.kind === 'disconnected') return <span className="status-chip status-disconnected"><i />No MCP client</span>
  else if (state.kind === 'connected') return <span className="status-chip status-connected"><i />Connected · {state.clients.join(', ')}</span>
  else if (state.kind === 'capturing') return <span className="status-chip status-capturing"><i />Model is looking · {state.clients.join(', ')}</span>
  else throw new Error(`Unknown capture state: ${JSON.stringify(state)}`)
}

