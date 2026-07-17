interface Props {
  stopped: boolean
  onToggle: () => void
}

export function StopButton({ stopped, onToggle }: Props) {
  return <button className={stopped ? 'stop-button stopped' : 'stop-button'} onClick={onToggle}>{stopped ? 'Resume serving' : 'STOP serving'}</button>
}

