import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import type { ClickTarget, ReadTarget, ScreenControlService } from './control'
import { clickInput, listElementsInput, lookInput, readTextInput, typeTextInput, waitForChangeInput, type ChangedLook, type LookOutcome } from './contract'
import { ScreenMcpError, asScreenMcpError } from './errors'
import type { ScreenCaptureService } from './service'

function mimeType(format: 'jpeg' | 'png'): 'image/jpeg' | 'image/png' {
  if (format === 'jpeg') return 'image/jpeg'
  else if (format === 'png') return 'image/png'
  else throw new Error(`Unknown frame format: ${JSON.stringify(format)}`)
}

export function lookResult(outcome: LookOutcome): CallToolResult {
  if (!outcome.changed) {
    const metadata = { changed: false, hash: outcome.hash, ...(outcome.highlights?.length ? { highlights: outcome.highlights } : {}) }
    return { content: [{ type: 'text', text: JSON.stringify(metadata) }] }
  }
  const metadata = {
    source: outcome.source.label,
    kind: outcome.source.kind,
    width: outcome.width,
    height: outcome.height,
    hash: outcome.hash,
    captured_at: new Date(outcome.capturedAt).toISOString(),
    frame_age_ms: outcome.frameAgeMs,
    nearly_black: outcome.nearlyBlack,
    changed: true,
    ...(outcome.highlights?.length ? { highlights: outcome.highlights } : {}),
  }
  return {
    content: [
      { type: 'image', data: outcome.data.toString('base64'), mimeType: mimeType(outcome.format) },
      { type: 'text', text: JSON.stringify(metadata) },
    ],
  }
}

export function toolError(error: unknown): CallToolResult {
  const known = asScreenMcpError(error)
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: known.code, message: known.message }) }] }
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

export function resourceResult(frame: ChangedLook): ReadResourceResult {
  return {
    contents: [{
      uri: 'screen://current',
      mimeType: mimeType(frame.format),
      blob: frame.data.toString('base64'),
      _meta: {
        source: frame.source.label,
        kind: frame.source.kind,
        width: frame.width,
        height: frame.height,
        hash: frame.hash,
        captured_at: new Date(frame.capturedAt).toISOString(),
        frame_age_ms: frame.frameAgeMs,
        nearly_black: frame.nearlyBlack,
        ...(frame.highlights?.length ? { highlights: frame.highlights } : {}),
      },
    }],
  }
}

export function createScreenMcpServer(service: ScreenCaptureService, control: ScreenControlService, clientName: string): McpServer {
  const server = new McpServer(
    { name: 'screenmcp', version: '0.1.0' },
    {
      instructions: 'The human selects the only source you may see. Use look with changed_since or wait_for_change to avoid vision tokens on idle frames. Never ask for source IDs. Read-only permits view calls; Interactive permits source-bound control; Off refuses every screen and control call while the connection may remain open. In Read-only, a supported click or type_text call may wait up to 120 seconds while ScreenMCP asks the human to switch to Interactive; if accepted, that same call continues. list_elements and read_text do not open this prompt. On capture_stopped, ask the human to switch from Off to Read-only or Interactive and do not retry. On no_source or control_not_armed, tell the human and do not retry.',
    },
  )
  server.registerTool('look', {
    title: 'Look at the selected screen source',
    description: 'Return the current human-selected source, or changed:false when its dHash matches changed_since.',
    inputSchema: lookInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ changed_since }) => {
    try {
      return lookResult(await service.look(clientName, changed_since))
    } catch (error) {
      return toolError(error)
    }
  })
  server.registerTool('describe_source', {
    title: 'Describe the selected source',
    description: 'Describe the source selected by the human without capturing an image.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await service.describeSource()) }] }
    } catch (error) {
      return toolError(error)
    }
  })
  server.registerTool('wait_for_change', {
    title: 'Wait for the selected source to change',
    description: 'Long-poll until the selected source changes or the timeout elapses.',
    inputSchema: waitForChangeInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ timeout_ms }) => {
    try {
      return lookResult(await service.waitForChange(clientName, timeout_ms))
    } catch (error) {
      return toolError(error)
    }
  })
  server.registerTool('list_elements', {
    title: 'List UI elements of the selected window',
    description: 'Return accessible controls with opaque references and payload-pixel bounds. Window sources only; requires human arming.',
    inputSchema: listElementsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async filter => {
    try { return jsonResult(await control.listElements(clientName, filter)) }
    catch (error) { return toolError(error) }
  })
  server.registerTool('read_text', {
    title: 'Read text from an element or image region',
    description: 'Read an accessible element exactly, or OCR a payload-pixel region from the redacted model frame. Requires human arming.',
    inputSchema: readTextInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async args => {
    try { return jsonResult(await control.readText(clientName, toReadTarget(args))) }
    catch (error) { return toolError(error) }
  })
  server.registerTool('click', {
    title: 'Click an element or payload-pixel point',
    description: 'Invoke an accessible element or move the real cursor and click a point inside the selected source. In Read-only, may wait while ScreenMCP asks the human to enable Interactive.',
    inputSchema: clickInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (args, extra) => {
    try { return jsonResult(await control.click(clientName, toClickTarget(args), { button: args.button, double: args.double }, extra.signal)) }
    catch (error) { return toolError(error) }
  })
  server.registerTool('type_text', {
    title: 'Type text into the selected window',
    description: 'Replace an accessible field value, or append with synthesized keystrokes; optionally submit with Enter. In Read-only, may wait while ScreenMCP asks the human to enable Interactive.',
    inputSchema: typeTextInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (args, extra) => {
    try { return jsonResult(await control.typeText(clientName, args.text, { element_ref: args.element_ref, append: args.append, submit: args.submit }, extra.signal)) }
    catch (error) { return toolError(error) }
  })
  server.registerResource('current-screen', 'screen://current', {
    title: 'Current ScreenMCP source',
    description: 'Latest frame from the single source selected by the human.',
    mimeType: 'image/jpeg',
  }, async () => resourceResult(await service.readCurrent(clientName)))
  return server
}

function toReadTarget(args: { element_ref?: string; region?: { x: number; y: number; width: number; height: number } }): ReadTarget {
  if (args.element_ref && !args.region) return { element_ref: args.element_ref }
  else if (!args.element_ref && args.region) return { region: args.region }
  else throw new ScreenMcpError('capture_failed', 'Provide exactly one of element_ref or region')
}

function toClickTarget(args: { element_ref?: string; x?: number; y?: number }): ClickTarget {
  if (args.element_ref && args.x === undefined && args.y === undefined) return { element_ref: args.element_ref }
  else if (!args.element_ref && args.x !== undefined && args.y !== undefined) return { x: args.x, y: args.y }
  else throw new ScreenMcpError('capture_failed', 'Provide exactly one element_ref or both x and y')
}
