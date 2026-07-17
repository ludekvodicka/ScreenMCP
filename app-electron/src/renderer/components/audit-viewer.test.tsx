import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../../shared/contracts'
import { AuditViewer } from './AuditViewer'

describe('AuditViewer', () => {
  it('renders the retained redacted frame and request metadata as a dialog', () => {
    const entry: AuditEntry = { id: 'entry-1', timestamp: 1, client: 'codex', action: 'look', source: 'Editor', sourceKind: 'window', changed: true, hash: '0123456789abcdef', bytes: 123, thumbnail: 'entry-1.jpg', error: null }
    const html = renderToStaticMarkup(<AuditViewer entry={entry} dataUrl="data:image/jpeg;base64,AA==" outcome="123 bytes" trigger={createRef<HTMLButtonElement>()} onClose={vi.fn()} />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('REDACTED FRAME SENT TO THE MODEL')
    expect(html).toContain('Editor')
    expect(html).toContain('123 bytes')
    expect(html).toContain('aria-label="Close audit frame"')
  })
})
