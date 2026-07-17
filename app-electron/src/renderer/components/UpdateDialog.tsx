import { useState } from 'react'
import type { UpdateStatus } from '../../shared/contracts'

interface Props {
  status: UpdateStatus
  onClose: () => void
}

export function UpdateDialog({ status, onClose }: Props) {
  const [snoozeHours, setSnoozeHours] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)

  async function act(action: () => Promise<unknown>): Promise<void> {
    try { await action(); setActionError(null) }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)) }
  }

  async function snooze(): Promise<void> {
    try {
      await window.screenmcp.snoozeUpdate(snoozeHours)
      setActionError(null)
      onClose()
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)) }
  }

  return (
    <div className="modal-backdrop update-backdrop" role="presentation">
      <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="update-heading">
          <div><p className="eyebrow">SCREENMCP UPDATE</p><h2 id="update-title">{dialogTitle(status)}</h2></div>
          <button className="dialog-close" aria-label="Close update dialog" onClick={onClose}>×</button>
        </div>
        <p className="update-reason">Running {status.running}. {status.reason}</p>
        {dialogBody(status, snoozeHours, setSnoozeHours, action => void act(action), () => void snooze(), onClose)}
        {actionError && <p className="inline-error update-error">{actionError}</p>}
      </section>
    </div>
  )
}

function dialogTitle(status: UpdateStatus): string {
  if (status.channel === 'none') return 'Manual updates'
  else if (status.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(status.channel)}`)
  if (status.phase === 'idle') return status.lastCheckAt ? 'ScreenMCP is up to date' : 'Check for updates'
  else if (status.phase === 'checking') return 'Checking for updates…'
  else if (status.phase === 'available') return `ScreenMCP ${status.pendingVersion ?? ''} is available`
  else if (status.phase === 'downloading') return `Downloading ${status.pendingVersion ?? 'update'}`
  else if (status.phase === 'ready') return `${status.pendingVersion ?? 'Update'} is ready`
  else if (status.phase === 'installing') return 'Restarting to install…'
  else if (status.phase === 'error') return 'Update failed'
  else throw new Error(`Unknown update phase: ${JSON.stringify(status.phase)}`)
}

function dialogBody(
  status: UpdateStatus,
  snoozeHours: number,
  setSnoozeHours: (hours: number) => void,
  act: (action: () => Promise<unknown>) => void,
  snooze: () => void,
  close: () => void,
) {
  if (status.channel === 'none') return <div className="update-actions"><button className="primary-button" onClick={() => act(() => window.screenmcp.openReleasePage())}>Open GitHub Releases</button><button onClick={close}>Close</button></div>
  else if (status.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(status.channel)}`)
  if (status.phase === 'idle') return <><p className="update-copy">{status.lastCheckOutcome ?? 'ScreenMCP will only check. It will not download anything without your approval.'}</p><div className="update-actions"><button className="primary-button" onClick={() => act(() => window.screenmcp.checkForUpdates())}>Check now</button><button onClick={close}>Close</button></div></>
  else if (status.phase === 'checking') return <div className="update-progress"><span /><p>Contacting GitHub Releases…</p></div>
  else if (status.phase === 'available') return <><p className="update-copy">Downloading starts only after you choose it. ScreenMCP keeps serving the current source while the file downloads.</p><div className="update-actions"><button className="primary-button" onClick={() => act(() => window.screenmcp.downloadUpdate())}>Download update</button><select aria-label="Snooze update" value={snoozeHours} onChange={event => setSnoozeHours(Number(event.target.value))}><option value="1">Later · 1 hour</option><option value="2">Later · 2 hours</option><option value="4">Later · 4 hours</option><option value="12">Later · 12 hours</option></select><button onClick={snooze}>Later</button></div></>
  else if (status.phase === 'downloading') return <><div className="update-meter"><i style={{ width: `${Math.max(0, Math.min(100, status.progress?.percent ?? 0))}%` }} /></div><p className="update-copy">{Math.round(status.progress?.percent ?? 0)}% · {formatBytes(status.progress?.transferred ?? 0)} of {formatBytes(status.progress?.total ?? 0)}</p></>
  else if (status.phase === 'ready') return <><p className="update-copy">The update is downloaded. Restart only when you are ready to disconnect active MCP clients.</p><div className="update-actions"><button className="primary-button" onClick={() => act(() => window.screenmcp.installUpdate())}>Restart &amp; install</button><button onClick={close}>Later</button></div></>
  else if (status.phase === 'installing') return <div className="update-progress"><span /><p>Closing ScreenMCP and starting the installer…</p></div>
  else if (status.phase === 'error') return <><p className="update-copy update-failure">{status.lastError ?? 'The update operation failed.'}</p><div className="update-actions"><button className="primary-button" onClick={() => act(status.pendingVersion ? () => window.screenmcp.downloadUpdate() : () => window.screenmcp.checkForUpdates())}>Retry</button><button onClick={() => act(() => window.screenmcp.openReleasePage())}>Open Releases</button><button onClick={close}>Close</button></div></>
  else throw new Error(`Unknown update phase: ${JSON.stringify(status.phase)}`)
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
