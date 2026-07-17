import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isInitializeRequest, type Implementation } from '@modelcontextprotocol/sdk/types.js'
import { createScreenMcpServer } from '../../../core/mcp/src/server'
import type { ScreenControlService } from '../../../core/mcp/src/control'
import type { ScreenCaptureService } from '../../../core/mcp/src/service'
import { readJsonBody, sendJson } from './http-common'

interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
  client: string
}

export interface McpRouterOptions {
  onConnected?: (sessionId: string, client: string) => void
  onActivity?: (sessionId: string, client: string) => void
  onStreamOpened?: (sessionId: string, client: string) => void
  onStreamClosed?: (sessionId: string) => void
  onDisconnected?: (sessionId: string) => void
}

export class McpRouter {
  private sessions = new Map<string, Session>()

  constructor(private service: ScreenCaptureService, private control: ScreenControlService, private options: McpRouterOptions = {}) {}

  handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method === 'POST') await this.handlePost(req, res)
      else if (req.method === 'GET' || req.method === 'DELETE') await this.handleSessionRequest(req, res)
      else if (req.method !== undefined) {
        res.setHeader('allow', 'GET, POST, DELETE')
        sendJson(res, 405, { error: 'method_not_allowed' })
      } else throw new Error('HTTP request has no method')
    } catch (error) {
      if (!res.headersSent) this.rpcError(res, 500, -32603, error instanceof Error ? error.message : String(error))
      else res.end()
    }
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.entries()]
    this.sessions.clear()
    await Promise.all(sessions.map(async ([sessionId, session]) => {
      this.options.onDisconnected?.(sessionId)
      await session.server.close().catch(() => undefined)
    }))
  }

  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req)
    const sessionId = this.sessionHeader(req)
    if (sessionId) {
      const session = this.sessions.get(sessionId)
      if (!session) {
        this.rpcError(res, 404, -32001, 'Unknown MCP session')
        return
      }
      this.options.onActivity?.(sessionId, session.client)
      await session.transport.handleRequest(req, res, body)
      return
    }
    if (!isInitializeRequest(body)) {
      this.rpcError(res, 400, -32000, 'No MCP session ID and request is not initialize')
      return
    }
    await this.initialize(req, res, body, body.params.clientInfo)
  }

  private async initialize(req: IncomingMessage, res: ServerResponse, body: unknown, clientInfo: Implementation): Promise<void> {
    const server = createScreenMcpServer(this.service, this.control, clientInfo.name)
    const cleanup = (sessionId: string): void => {
      if (!this.sessions.delete(sessionId)) return
      this.options.onDisconnected?.(sessionId)
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: sessionId => {
        this.sessions.set(sessionId, { transport, server, client: clientInfo.name })
        this.options.onConnected?.(sessionId, clientInfo.name)
      },
      onsessionclosed: cleanup,
    })
    transport.onclose = () => {
      if (transport.sessionId) cleanup(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  private async handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = this.sessionHeader(req)
    const session = sessionId ? this.sessions.get(sessionId) : undefined
    if (!sessionId || !session) {
      this.rpcError(res, 400, -32001, 'Missing or unknown MCP session ID')
      return
    }
    this.options.onActivity?.(sessionId, session.client)
    if (req.method === 'GET') {
      let closed = false
      const closePresence = (): void => {
        if (closed) return
        closed = true
        req.off('aborted', closePresence)
        res.off('close', closePresence)
        res.off('finish', closePresence)
        this.options.onStreamClosed?.(sessionId)
      }
      req.once('aborted', closePresence)
      res.once('close', closePresence)
      res.once('finish', closePresence)
      this.options.onStreamOpened?.(sessionId, session.client)
      try { await session.transport.handleRequest(req, res) }
      catch (error) { closePresence(); throw error }
      return
    } else if (req.method === 'DELETE') {
      await session.transport.handleRequest(req, res)
      return
    } else throw new Error(`Unknown session method: ${JSON.stringify(req.method)}`)
  }

  private sessionHeader(req: IncomingMessage): string | undefined {
    const value = req.headers['mcp-session-id']
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  private rpcError(res: ServerResponse, status: number, code: number, message: string): void {
    sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null })
  }
}
