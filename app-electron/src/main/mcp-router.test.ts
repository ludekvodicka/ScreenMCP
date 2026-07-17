import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { LookOutcome, SourceDescription } from '../../../core/mcp/src/contract'
import type { ScreenCaptureService } from '../../../core/mcp/src/service'
import type { ScreenControlService } from '../../../core/mcp/src/control'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpHost } from './mcp-host'
import { McpRouter } from './mcp-router'

class FakeCaptureService implements ScreenCaptureService {
  look = vi.fn<(client: string, changedSince?: string) => Promise<LookOutcome>>((_client, changedSince) => {
    if (changedSince === '0123456789abcdef') return Promise.resolve({ changed: false, hash: changedSince })
    return Promise.resolve(this.frame())
  })
  waitForChange = vi.fn<(client: string, timeoutMs: number) => Promise<LookOutcome>>(() => Promise.resolve({ changed: false, hash: '0123456789abcdef' }))
  describeSource = vi.fn<() => Promise<SourceDescription>>(() => Promise.resolve({
    kind: 'window',
    label: 'Editor',
    width: 100,
    height: 60,
    masks: 0,
    highlights: [],
    policy: { format: 'jpeg', jpegQuality: 80, maxLongSide: 1568 },
  }))
  readCurrent = vi.fn(() => Promise.resolve(this.frame()))

  private frame() {
    return {
      changed: true as const,
      hash: '0123456789abcdef',
      data: Buffer.from('frame'),
      format: 'jpeg' as const,
      width: 100,
      height: 60,
      capturedAt: 0,
      frameAgeMs: 0,
      nearlyBlack: false,
      source: { kind: 'window' as const, label: 'Editor' },
    }
  }
}

class FakeControlService implements ScreenControlService {
  listElements = vi.fn(() => Promise.resolve({ elements: [], truncated: false, source: { kind: 'window', label: 'Editor' } }))
  readText = vi.fn(() => Promise.resolve({ text: 'Editor', method: 'uia' as const }))
  click = vi.fn(() => Promise.resolve({ ok: true as const, method: 'uia' as const }))
  typeText = vi.fn<ScreenControlService['typeText']>(() => Promise.resolve({ ok: true as const, method: 'uia' as const }))
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  delete process.env.SCREENMCP_HOME
})

describe('MCP Streamable HTTP router', () => {
  it('connects a named client and serves all ScreenMCP tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-router-'))
    process.env.SCREENMCP_HOME = directory
    const service = new FakeCaptureService()
    const control = new FakeControlService()
    const connected = vi.fn()
    const activity = vi.fn()
    const streamOpened = vi.fn()
    const streamClosed = vi.fn()
    const disconnected = vi.fn()
    const router = new McpRouter(service, control, { onConnected: connected, onActivity: activity, onStreamOpened: streamOpened, onStreamClosed: streamClosed, onDisconnected: disconnected })
    const token = 'b'.repeat(48)
    const host = new McpHost(token, router.handle)
    const endpoint = await host.start()
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
    const client = new Client({ name: 'contract-test-client', version: '1.0.0' })
    const secondTransport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    })
    const secondClient = new Client({ name: 'second-client', version: '2.0.0' })
    cleanups.push(async () => {
      await client.close().catch(() => undefined)
      await secondClient.close().catch(() => undefined)
      await router.close()
      await host.stop()
      await rm(directory, { recursive: true, force: true })
    })

    await client.connect(transport)
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name).sort()).toEqual(['click', 'describe_source', 'list_elements', 'look', 'read_text', 'type_text', 'wait_for_change'])
    const first = await client.callTool({ name: 'look', arguments: {} })
    expect(first.content).toMatchObject([{ type: 'image' }, { type: 'text' }])
    const second = await client.callTool({ name: 'look', arguments: { changed_since: '0123456789abcdef' } })
    expect(second.content).toEqual([{ type: 'text', text: '{"changed":false,"hash":"0123456789abcdef"}' }])
    expect(service.look).toHaveBeenCalledWith('contract-test-client', undefined)
    const click = await client.callTool({ name: 'click', arguments: { element_ref: 'e1' } })
    expect(click.content).toEqual([{ type: 'text', text: '{"ok":true,"method":"uia"}' }])
    expect(control.click).toHaveBeenCalledWith('contract-test-client', { element_ref: 'e1' }, { button: 'left', double: false }, expect.any(AbortSignal))
    let releaseType!: () => void
    control.typeText.mockImplementation((_client, _text, _options, signal) => {
      expect(signal?.aborted).toBe(false)
      return new Promise(resolve => { releaseType = () => resolve({ ok: true, method: 'uia' }) })
    })
    let typeSettled = false
    const typeCall = client.callTool({ name: 'type_text', arguments: { text: 'hello', element_ref: 'e1' } }).then(result => { typeSettled = true; return result })
    await vi.waitFor(() => expect(control.typeText).toHaveBeenCalledOnce())
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(typeSettled).toBe(false)
    releaseType()
    await expect(typeCall).resolves.toMatchObject({ content: [{ type: 'text', text: '{"ok":true,"method":"uia"}' }] })
    expect(connected).toHaveBeenCalledWith(expect.any(String), 'contract-test-client')
    await secondClient.connect(secondTransport)
    await secondClient.callTool({ name: 'look', arguments: {} })
    expect(service.look).toHaveBeenCalledWith('second-client', undefined)
    expect(connected).toHaveBeenCalledWith(expect.any(String), 'second-client')
    expect(activity).toHaveBeenCalled()
    await vi.waitFor(() => expect(streamOpened).toHaveBeenCalled())
    await client.close()
    await vi.waitFor(() => expect(streamClosed).toHaveBeenCalled())
    expect(disconnected).not.toHaveBeenCalled()
  })
})
