import { useEffect, useRef, useState } from 'react'
import type { AuditEntry } from '../../shared/contracts'
import { AuditViewer } from './AuditViewer'

type ThumbnailState =
  | { kind: 'loading' }
  | { kind: 'ready'; dataUrl: string }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

function AuditThumbnail({ entry }: { entry: AuditEntry }) {
  const [state, setState] = useState<ThumbnailState>(entry.thumbnail ? { kind: 'loading' } : { kind: 'missing' })
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    if (!entry.thumbnail) { setState({ kind: 'missing' }); return () => { active = false } }
    setState({ kind: 'loading' })
    void window.screenmcp.getAuditThumbnail(entry.id).then(
      value => { if (active) setState(value ? { kind: 'ready', dataUrl: value } : { kind: 'missing' }) },
      reason => { if (active) setState({ kind: 'error', message: reason instanceof Error ? reason.message : String(reason) }) },
    )
    return () => { active = false }
  }, [entry.id, entry.thumbnail])

  if (state.kind === 'loading') return <span className="audit-thumbnail audit-thumbnail-status">Loading…</span>
  else if (state.kind === 'missing') return <span className="audit-thumbnail empty" aria-label="No retained frame" />
  else if (state.kind === 'error') return <span className="audit-thumbnail audit-thumbnail-status error" title={state.message}>Unavailable</span>
  else if (state.kind === 'ready') return <><button ref={trigger} type="button" className="audit-thumbnail-button" aria-label={`Open redacted frame from ${new Date(entry.timestamp).toLocaleString()}`} onClick={() => setOpen(true)}><img className="audit-thumbnail" src={state.dataUrl} alt="" /></button>{open && <AuditViewer entry={entry} dataUrl={state.dataUrl} outcome={outcome(entry)} trigger={trigger} onClose={() => setOpen(false)} />}</>
  else throw new Error(`Unknown audit thumbnail state: ${JSON.stringify(state)}`)
}

export function outcome(entry: AuditEntry): string {
  const control = entry.outcome ? `${entry.method ?? '—'} · ${entry.target ?? '—'} · ${entry.outcome}` : null
  if (entry.error) return control ? `${control} · ${entry.error}` : entry.error
  if (control) return control
  if (entry.changed === true) return `${entry.bytes?.toLocaleString() ?? 0} bytes · ${entry.hash}`
  else if (entry.changed === false) return `unchanged · ${entry.hash}`
  else if (entry.changed === null) return 'no frame returned'
  else throw new Error(`Unknown audit outcome: ${JSON.stringify(entry.changed)}`)
}

export function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.screenmcp.listAudit(200).then(value => { if (active) { setEntries(value); setError(null) } }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    const unsubscribe = window.screenmcp.onAuditEntry(entry => setEntries(current => [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 200)))
    return () => { active = false; unsubscribe() }
  }, [])
  return (
    <section className="audit-panel">
      <div className="section-heading"><div><p className="eyebrow">LOCAL JSONL AUDIT</p><h2>Every request is visible</h2></div><span>{entries.length} recent</span></div>
      {error && <p className="inline-error">{error}</p>}
      {entries.length === 0 ? <div className="empty-list">No model has looked yet.</div> : (
        <div className="audit-list">
          {entries.map(entry => (
            <article className={entry.error ? 'audit-row audit-error' : 'audit-row'} key={entry.id}>
              <AuditThumbnail entry={entry} />
              <time>{new Date(entry.timestamp).toLocaleString()}</time>
              <strong>{entry.client}</strong>
              <span className="audit-action">{entry.action}</span>
              <span title={entry.source ?? ''}>{entry.source ?? 'No source'}</span>
              <small>{outcome(entry)}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
