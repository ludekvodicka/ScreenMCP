import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SourceSelection } from '../../shared/contracts'
import { SourcePicker } from './SourcePicker'

describe('SourcePicker active dialog state', () => {
  it('shows that the current window is an automatically followed dialog', () => {
    const selection: SourceSelection = {
      captureId: 'window:202:0',
      kind: 'window',
      label: 'Total Commander › Confirm replace',
      width: 600,
      height: 400,
      followedFrom: { captureId: 'window:101:0', label: 'Total Commander' },
    }
    const html = renderToStaticMarkup(<SourcePicker selection={selection} busy={false} wayland={false} macScreenPermission="not-applicable" error={null} onPick={() => undefined} onScreen={() => undefined} onPortal={() => undefined} onRequestPermission={() => undefined} onOpenPermissionSettings={() => undefined} onRelaunch={() => undefined} />)
    expect(html).toContain('following active dialog')
    expect(html).toContain('Total Commander › Confirm replace')
  })
})
