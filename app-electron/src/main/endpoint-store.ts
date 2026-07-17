import { randomBytes } from 'node:crypto'
import type { EndpointInfo } from '../shared/contracts'
import { endpointPath } from './paths'
import { readJsonFile, writeJsonAtomic } from './json-store'

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{48}$/.test(value)
}

export async function loadOrCreateToken(): Promise<string> {
  const existing = await readJsonFile<Partial<EndpointInfo>>(endpointPath())
  if (validToken(existing?.token)) return existing.token
  return randomBytes(24).toString('hex')
}

export async function writeEndpoint(endpoint: EndpointInfo): Promise<void> {
  await writeJsonAtomic(endpointPath(), endpoint)
}

export async function rotateToken(endpoint: Omit<EndpointInfo, 'token'>): Promise<EndpointInfo> {
  const next = { ...endpoint, token: randomBytes(24).toString('hex') }
  await writeEndpoint(next)
  return next
}

