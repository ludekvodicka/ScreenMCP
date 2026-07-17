import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { InteractiveRequest } from '../../shared/contracts'
import { InteractiveRequestDialog } from './InteractiveRequestDialog'

describe('InteractiveRequestDialog', () => {
  it.each([
    ['click', 'wants to click in Editor'],
    ['type_text', 'wants to type text in Editor'],
  ] satisfies Array<[InteractiveRequest['action'], string]>)('describes %s as a source-wide mode request', (action, expected) => {
    const request: InteractiveRequest = { id: 'request-1', client: 'codex', action, source: 'Editor' }
    const html = renderToStaticMarkup(<InteractiveRequestDialog request={request} onDecision={vi.fn(() => Promise.resolve())} />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain(expected)
    expect(html).toContain('all connected MCP clients')
    expect(html).toContain('Keep Read-only')
    expect(html).toContain('Switch to Interactive &amp; continue')
  })

  it('has no field capable of receiving or displaying typed content', () => {
    const request: InteractiveRequest = { id: 'request-1', client: 'claude', action: 'type_text', source: 'Private editor' }
    const html = renderToStaticMarkup(<InteractiveRequestDialog request={request} onDecision={vi.fn(() => Promise.resolve())} />)

    expect(html).not.toContain('<input')
    expect(html).not.toContain('<textarea')
  })
})
