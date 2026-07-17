import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ControlState, SourceSelection } from '../../shared/contracts'
import { ControlPanel } from './ControlPanel'

const unarmed: ControlState = { armed: false, sourceKey: null }
const selection: SourceSelection = { captureId: 'window:77:0', kind: 'window', label: 'Editor', width: 100, height: 100 }

describe('ControlPanel', () => {
  it('marks Read-only active and offers Interactive from read-only state', () => {
    const html = renderToStaticMarkup(<ControlPanel state={unarmed} selection={selection} stopped={false} available />)
    expect(html).toContain('>Read-only<')
    expect(html).toContain('>Interactive<')
    expect(html).toContain('<button type="button" class="active" aria-pressed="true"')
    expect(html).not.toContain('active armed')
    expect(html).not.toContain('mode-blocked')
  })

  it('marks Off active without making stopped state block an Interactive transition', () => {
    const html = renderToStaticMarkup(<ControlPanel state={unarmed} selection={selection} stopped available />)
    expect(html).toContain('<button type="button" class="active off" aria-pressed="true"')
    expect(html).toContain('Screen access is off')
    expect(html).toContain('Clients may stay connected')
    expect(html).not.toContain('mode-blocked')
  })

  it('explains source and platform prerequisites next to the switch', () => {
    expect(renderToStaticMarkup(<ControlPanel state={unarmed} selection={null} stopped={false} available />)).toContain('Select a source first')
    expect(renderToStaticMarkup(<ControlPanel state={unarmed} selection={selection} stopped={false} available={false} />)).toContain('Available on Windows only')
  })

  it('marks Interactive active while armed with Read-only as the direct revoke', () => {
    const state: ControlState = { armed: true, sourceKey: 'window:Editor' }
    const html = renderToStaticMarkup(<ControlPanel state={state} selection={selection} stopped={false} available />)
    expect(html).toContain('active armed')
    expect(html).toContain('Editor')
    expect(html).not.toContain('mode-blocked')
  })

  it('does not promise keyboard or accessibility actions for a region', () => {
    const state: ControlState = { armed: true, sourceKey: 'region:demo' }
    const region: SourceSelection = { captureId: 'screen:1', kind: 'region', label: 'Crop', region: { x: 0, y: 0, width: 100, height: 100 }, width: 100, height: 100 }
    const html = renderToStaticMarkup(<ControlPanel state={state} selection={region} stopped={false} available />)
    expect(html).toContain('OCR visible text and click')
    expect(html).toContain('Keyboard and accessibility-control actions remain unavailable')
  })
})
