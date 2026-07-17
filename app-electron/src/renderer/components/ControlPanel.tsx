import { useState } from 'react'
import { accessMode } from '../../shared/access-mode'
import type { AccessMode, ControlState, SourceSelection } from '../../shared/contracts'

interface Props {
  state: ControlState
  selection: SourceSelection | null
  stopped: boolean
  available: boolean
}

export function ControlPanel({ state, selection, stopped, available }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mode = accessMode({ stopped, armed: state.armed })

  async function selectMode(next: AccessMode): Promise<void> {
    if (next === mode) return
    setBusy(true)
    try {
      await window.screenmcp.setAccessMode(next)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const blocked = state.armed ? null : blockedReason(available, selection !== null)
  return (
    <section className="control-panel">
      <p className="eyebrow">ACCESS MODE</p>
      <div className="mode-switch">
        <button type="button" className={mode === 'off' ? 'active off' : ''} aria-pressed={mode === 'off'} disabled={busy} onClick={() => void selectMode('off')}>Off</button>
        <button type="button" className={mode === 'read-only' ? 'active' : ''} aria-pressed={mode === 'read-only'} disabled={busy} onClick={() => void selectMode('read-only')}>Read-only</button>
        <button type="button" className={mode === 'interactive' ? 'active armed' : ''} aria-pressed={mode === 'interactive'} disabled={busy || blocked !== null} onClick={() => void selectMode('interactive')}>Interactive</button>
      </div>
      {blocked && <p className="mode-blocked">ⓘ {blocked}</p>}
      <p className="control-copy">{modeCopy(mode, selection)}</p>
      {error && <p className="inline-error">{error}</p>}
      <small>{modeDetail(mode)}</small>
    </section>
  )
}

function modeCopy(mode: AccessMode, selection: SourceSelection | null): string {
  if (mode === 'off') return 'Screen access is off. Connected clients cannot capture, inspect, click, or type until you choose Read-only or Interactive.'
  else if (mode === 'read-only') return 'The model can see the selected source, but cannot inspect controls, read UI text, click, or type.'
  else if (mode === 'interactive') return allowedCopy(selection)
  else throw new Error(`Unknown access mode: ${JSON.stringify(mode)}`)
}

function modeDetail(mode: AccessMode): string {
  if (mode === 'off') return 'Clients may stay connected, but every screen and control request is refused.'
  else if (mode === 'read-only') return 'Switching the source keeps Read-only. STOP selects Off.'
  else if (mode === 'interactive') return 'Stays on until you switch back to Read-only, press STOP, or switch source.'
  else throw new Error(`Unknown access mode: ${JSON.stringify(mode)}`)
}

function allowedCopy(selection: SourceSelection | null): string {
  if (!selection) return 'The model may interact with the selected source.'
  if (selection.kind === 'window') return `The model may inspect controls, read UI text, click, and type on ${selection.label}.`
  else if (selection.kind === 'monitor' || selection.kind === 'region') return `The model may OCR visible text and click within ${selection.label}. Keyboard and accessibility-control actions remain unavailable for this source type.`
  else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
}

function blockedReason(available: boolean, selected: boolean): string | null {
  if (!available) return 'Available on Windows only'
  if (!selected) return 'Select a source first'
  return null
}
