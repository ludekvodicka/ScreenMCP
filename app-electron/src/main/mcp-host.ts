import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EndpointInfo } from '../shared/contracts'
import { writeEndpoint } from './endpoint-store'
import { bearerToken, hasBrowserOrigin, hostAllowed, sendJson, timingSafeMatch } from './http-common'

const DEFAULT_PORT = 47_210

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

async function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

export class McpHost {
  private server: Server | null = null
  private endpoint: EndpointInfo | null = null

  constructor(private token: string, private handleMcp?: McpRequestHandler) {}

  getEndpoint(): EndpointInfo | null {
    return this.endpoint ? { ...this.endpoint } : null
  }

  setToken(token: string): void {
    this.token = token
    if (this.endpoint) this.endpoint = { ...this.endpoint, token }
  }

  setMcpHandler(handler: McpRequestHandler): void {
    this.handleMcp = handler
  }

  async start(): Promise<EndpointInfo> {
    if (this.server && this.endpoint) return { ...this.endpoint }
    let allowed = new Set<string>()
    const server = createServer((req, res) => {
      void this.route(req, res, allowed).catch((error: unknown) => {
        if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
        else res.end()
        console.error('HTTP request failed', error)
      })
    })
    let port: number
    try {
      port = await listen(server, DEFAULT_PORT)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      port = await listen(server, 0)
    }
    allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost'])
    this.server = server
    this.endpoint = { url: `http://127.0.0.1:${port}/mcp`, token: this.token, port }
    await writeEndpoint(this.endpoint)
    return { ...this.endpoint }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.endpoint = null
    if (!server) return
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }

  private async route(req: IncomingMessage, res: ServerResponse, allowed: ReadonlySet<string>): Promise<void> {
    if (hasBrowserOrigin(req) || !hostAllowed(req, allowed)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    if (!timingSafeMatch(bearerToken(req), this.token)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/health') {
      sendJson(res, 200, { ok: true, service: 'screenmcp' })
      return
    }
    if (path === '/mcp' && this.handleMcp) {
      await this.handleMcp(req, res)
      return
    }
    if (path === '/mcp') {
      sendJson(res, 503, { error: 'mcp_not_ready' })
      return
    }
    sendJson(res, 404, { error: 'not_found' })
  }
}
