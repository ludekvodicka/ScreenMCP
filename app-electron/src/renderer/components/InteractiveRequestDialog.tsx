import { useEffect, useState } from 'react'
import type { InteractiveRequest, InteractiveRequestDecision } from '../../shared/contracts'

interface Props {
  request: InteractiveRequest
  onDecision: (decision: InteractiveRequestDecision) => Promise<void>
}

export function InteractiveRequestDialog({ request, onDecision }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: InteractiveRequestDecision): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await onDecision(decision)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      void decide('keep-read-only')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="modal-backdrop interactive-request-backdrop">
      <section className="interactive-request-dialog" role="dialog" aria-modal="true" aria-labelledby="interactive-request-title">
        <div className="interactive-request-icon">↗</div>
        <p className="eyebrow">MCP INTERACTION REQUEST</p>
        <h2 id="interactive-request-title">{request.client} wants to {actionLabel(request.action)} in {request.source}</h2>
        <p>ScreenMCP is Read-only. Switch this source to Interactive and continue the waiting MCP request?</p>
        <p className="interactive-request-warning">Interactive applies to all connected MCP clients until you choose Read-only or Off, change the source, or quit ScreenMCP.</p>
        {error && <p className="inline-error">{error}</p>}
        <div className="interactive-request-actions">
          <button type="button" disabled={busy} onClick={() => void decide('keep-read-only')}>Keep Read-only</button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void decide('enable-interactive')}>Switch to Interactive &amp; continue</button>
        </div>
      </section>
    </div>
  )
}

function actionLabel(action: InteractiveRequest['action']): string {
  if (action === 'click') return 'click'
  else if (action === 'type_text') return 'type text'
  else
    throw new Error(`Unknown interactive write action: ${JSON.stringify(action)}`)
}
