import { describe, expect, it } from 'vitest'
import { lookResult, resourceResult, toolError } from '../src/server'
import { ScreenMcpError } from '../src/errors'
import { asScreenMcpError } from '../src/errors'
import type { ToolErrorCode } from '../src/contract'

describe('MCP result contracts', () => {
  it('omits image content for unchanged frames', () => {
    const result = lookResult({ changed: false, hash: '0123456789abcdef', highlights: [] })
    expect(result.content).toEqual([{ type: 'text', text: '{"changed":false,"hash":"0123456789abcdef"}' }])
  })

  it('keeps non-empty highlight metadata on unchanged frames', () => {
    const result = lookResult({ changed: false, hash: '0123456789abcdef', highlights: [{ n: 1, shape: 'rect', label: 'save', x: 4, y: 5, width: 6, height: 7 }] })
    expect(result.content).toEqual([{ type: 'text', text: '{"changed":false,"hash":"0123456789abcdef","highlights":[{"n":1,"shape":"rect","label":"save","x":4,"y":5,"width":6,"height":7}]}' }])
  })

  it('returns image followed by machine-readable metadata for changed frames', () => {
    const result = lookResult({
      changed: true,
      hash: '0123456789abcdef',
      data: Buffer.from('frame'),
      format: 'jpeg',
      width: 100,
      height: 60,
      capturedAt: 0,
      frameAgeMs: 4,
      nearlyBlack: false,
      source: { kind: 'window', label: 'Editor' },
      highlights: [{ n: 1, shape: 'rect', x: 4, y: 5, width: 6, height: 7 }],
    })
    expect(result.content.map(block => block.type)).toEqual(['image', 'text'])
    const metadataBlock = result.content[1]
    if (!metadataBlock || metadataBlock.type !== 'text') throw new Error('Expected text metadata')
    expect(JSON.parse(metadataBlock.text)).toMatchObject({ highlights: [{ n: 1, shape: 'rect', x: 4, y: 5, width: 6, height: 7 }] })
  })

  it('uses structured tool errors', () => {
    expect(toolError(new ScreenMcpError('capture_stopped', 'Human pressed STOP.'))).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: '{"error":"capture_stopped","message":"Human pressed STOP."}' }],
    })
  })

  it('preserves every interactive-control error code', () => {
    const codes: ToolErrorCode[] = ['control_not_armed', 'control_unavailable', 'element_actions_unavailable', 'element_not_found', 'element_stale', 'out_of_bounds', 'not_invokable', 'not_editable', 'injection_failed', 'ocr_failed', 'text_rejected']
    for (const code of codes) expect(asScreenMcpError(new ScreenMcpError(code, code)).code).toBe(code)
    expect(asScreenMcpError(new Error('unknown')).code).toBe('capture_failed')
  })

  it('keeps resource freshness metadata aligned with look', () => {
    const result = resourceResult({
      changed: true,
      hash: '0123456789abcdef',
      data: Buffer.from('frame'),
      format: 'jpeg',
      width: 100,
      height: 60,
      capturedAt: 0,
      frameAgeMs: 19,
      nearlyBlack: true,
      source: { kind: 'window', label: 'Editor' },
      highlights: [{ n: 1, shape: 'rect', label: 'save', x: 4, y: 5, width: 6, height: 7 }],
    })
    expect(result.contents[0]?._meta).toMatchObject({ frame_age_ms: 19, nearly_black: true, highlights: [{ n: 1, shape: 'rect', label: 'save', x: 4, y: 5, width: 6, height: 7 }] })
  })

  it('omits empty highlight fields from changed look and resource metadata', () => {
    const frame = {
      changed: true as const,
      hash: '0123456789abcdef',
      data: Buffer.from('frame'),
      format: 'png' as const,
      width: 10,
      height: 10,
      capturedAt: 0,
      frameAgeMs: 0,
      nearlyBlack: false,
      source: { kind: 'monitor' as const, label: 'Monitor' },
    }
    const look = lookResult(frame)
    const metadataBlock = look.content[1]
    if (!metadataBlock || metadataBlock.type !== 'text') throw new Error('Expected text metadata')
    const metadata = JSON.parse(metadataBlock.text) as Record<string, unknown>

    expect(metadata).not.toHaveProperty('highlights')
    expect(resourceResult(frame).contents[0]?._meta).not.toHaveProperty('highlights')
  })
})
