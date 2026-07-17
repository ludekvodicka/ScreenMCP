import type { UpdateStatus } from '../../shared/contracts'

interface Props {
  status: UpdateStatus
  onClick: () => void
}

export function UpdateChip({ status, onClick }: Props) {
  return <button className={`update-chip update-${status.phase}`} onClick={onClick}>{chipLabel(status)}</button>
}

function chipLabel(status: UpdateStatus): string {
  if (status.channel === 'none') return 'Updates · manual'
  else if (status.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(status.channel)}`)
  if (status.phase === 'idle') return status.lastCheckAt ? 'Updates · current' : 'Updates'
  else if (status.phase === 'checking') return 'Checking…'
  else if (status.phase === 'available') return `${status.pendingVersion ?? 'Update'} available`
  else if (status.phase === 'downloading') return `Update · ${Math.round(status.progress?.percent ?? 0)}%`
  else if (status.phase === 'ready') return 'Restart to update'
  else if (status.phase === 'installing') return 'Installing…'
  else if (status.phase === 'error') return 'Update error'
  else throw new Error(`Unknown update phase: ${JSON.stringify(status.phase)}`)
}
