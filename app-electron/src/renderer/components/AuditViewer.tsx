import { useEffect, useRef, type RefObject } from 'react'
import type { AuditEntry } from '../../shared/contracts'

interface Props {
  entry: AuditEntry
  dataUrl: string
  outcome: string
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}

export function AuditViewer({ entry, dataUrl, outcome, trigger, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    closeButton.current?.focus()
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') close.current() }
    window.addEventListener('keydown', keyDown)
    return () => { window.removeEventListener('keydown', keyDown); trigger.current?.focus() }
  }, [trigger])

  return (
    <div className="modal-backdrop audit-viewer-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="audit-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby={`audit-viewer-${entry.id}`}>
        <div className="audit-viewer-heading">
          <div><p className="eyebrow">REDACTED FRAME SENT TO THE MODEL</p><h2 id={`audit-viewer-${entry.id}`}>{entry.action} · {entry.client}</h2></div>
          <button ref={closeButton} type="button" className="dialog-close" aria-label="Close audit frame" onClick={onClose}>×</button>
        </div>
        <figure className="audit-viewer-frame"><img src={dataUrl} alt={`Redacted frame sent to ${entry.client} for ${entry.action}`} /></figure>
        <dl className="audit-viewer-meta">
          <div><dt>Time</dt><dd>{new Date(entry.timestamp).toLocaleString()}</dd></div>
          <div><dt>Source</dt><dd title={entry.source ?? ''}>{entry.source ?? 'No source'}</dd></div>
          <div><dt>Kind</dt><dd>{entry.sourceKind ?? '—'}</dd></div>
          <div><dt>Outcome</dt><dd title={outcome}>{outcome}</dd></div>
        </dl>
      </section>
    </div>
  )
}
