import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
}

export function timingSafeMatch(provided: string | undefined, secret: string): boolean {
  if (!provided) return false
  const left = createHash('sha256').update(provided).digest()
  const right = createHash('sha256').update(secret).digest()
  return timingSafeEqual(left, right)
}

export function hostAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean {
  const raw = String(req.headers.host ?? '').toLowerCase()
  if (!raw) return false
  if (allowed.has(raw)) return true
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    const host = end > 0 ? raw.slice(1, end) : raw.slice(1)
    return allowed.has(host)
  }
  return allowed.has(raw.split(':')[0] ?? '')
}

export function hasBrowserOrigin(req: IncomingMessage): boolean {
  return typeof req.headers.origin === 'string' && req.headers.origin.length > 0
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export async function readJsonBody(req: IncomingMessage, maximumBytes = 1 << 20): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    bytes += buffer.length
    if (bytes > maximumBytes) throw new RangeError('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
