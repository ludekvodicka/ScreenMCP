import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HighlightEditor } from './HighlightEditor'
import { MaskEditor } from './MaskEditor'

describe('annotation editors', () => {
  it('keeps delete and label editing available outside drawing mode (user decision: annotations editable anytime)', () => {
    const maskIdle = renderToStaticMarkup(<MaskEditor sourceWidth={100} sourceHeight={100} masks={[{ id: 'mask', x: 10, y: 10, width: 20, height: 20 }]} editing={false} onChange={vi.fn()} onDone={vi.fn()} />)
    const highlight = renderToStaticMarkup(<HighlightEditor sourceWidth={100} sourceHeight={100} highlights={[{ id: 'highlight', shape: 'rect', label: 'Target', x: 20, y: 20, width: 30, height: 30 }]} editing={false} onChange={vi.fn()} onDone={vi.fn()} />)

    expect(maskIdle).toContain('aria-label="Delete redaction"')
    expect(maskIdle).toContain('aria-label="Move redaction"')
    expect(maskIdle.match(/data-rectangle-action="resize"/g)).toHaveLength(8)
    expect(maskIdle).not.toContain('Drag to hide sensitive content')
    expect(highlight).toContain('aria-label="Delete highlight 1"')
    expect(highlight).toContain('aria-label="Move highlight 1"')
    expect(highlight.match(/data-rectangle-action="resize"/g)).toHaveLength(8)
    for (const handle of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
      expect(maskIdle).toContain(`data-resize-handle="${handle}"`)
      expect(highlight).toContain(`data-resize-handle="${handle}"`)
    }
    expect(highlight).toContain('aria-label="Label highlight 1"')
    expect(highlight).toContain('Target')
    expect(highlight).not.toContain('Drag to point out an area')
  })

  it('shows Ctrl-aware drawing instructions only in active mode', () => {
    const mask = renderToStaticMarkup(<MaskEditor sourceWidth={100} sourceHeight={100} masks={[]} editing onChange={vi.fn()} onDone={vi.fn()} />)
    const highlight = renderToStaticMarkup(<HighlightEditor sourceWidth={100} sourceHeight={100} highlights={[{ id: 'highlight', shape: 'rect', x: 20, y: 20, width: 30, height: 30 }]} editing onChange={vi.fn()} onDone={vi.fn()} />)

    expect(mask).toContain('Drag to hide sensitive content')
    expect(mask).toContain('Hold Ctrl to move the draft')
    expect(highlight).toContain('Drag to point out an area')
    expect(highlight).toContain('Hold Ctrl to move the draft')
    expect(highlight).toContain('aria-label="Label highlight 1"')
  })
})
