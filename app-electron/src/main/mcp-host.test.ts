import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { McpHost } from './mcp-host'

const hosts: McpHost[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  delete process.env.SCREENMCP_HOME
})

describe('McpHost', () => {
  it('protects health with host, origin, and bearer checks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-host-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const token = 'a'.repeat(48)
    const host = new McpHost(token)
    hosts.push(host)
    const endpoint = await host.start()
    const health = endpoint.url.replace(/\/mcp$/, '/health')

    expect((await fetch(health)).status).toBe(401)
    expect((await fetch(health, { headers: { authorization: `Bearer ${token}`, origin: 'https://example.test' } })).status).toBe(403)
    const response = await fetch(health, { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, service: 'screenmcp' })

    const saved = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8')) as Record<string, unknown>
    expect(saved).toMatchObject(endpoint)
  })
})
