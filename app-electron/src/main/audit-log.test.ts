import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditLog } from './audit-log'

vi.mock('./streams', () => ({ publish: vi.fn() }))

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  delete process.env.SCREENMCP_HOME
})

describe('AuditLog', () => {
  it('keeps only the configured thumbnail ring', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-audit-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const thumbnail = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).jpeg().toBuffer()
    const audit = new AuditLog(() => 1)
    const first = await audit.append(entry(), thumbnail)
    const second = await audit.append(entry(), thumbnail)
    expect(await audit.thumbnail(first.id)).toBeNull()
    expect(await audit.thumbnail(second.id)).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('round-trips additive control fields while old entries remain valid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-audit-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const audit = new AuditLog()
    await audit.append(entry())
    await audit.append({ ...entry(), action: 'type', changed: null, hash: null, bytes: null, target: 'Editor · [redacted 6 chars]', method: 'uia', outcome: 'ok' })
    const entries = await audit.list()
    expect(entries[0]).toMatchObject({ action: 'type', target: 'Editor · [redacted 6 chars]', method: 'uia', outcome: 'ok' })
    expect(entries[1]).not.toHaveProperty('target')
  })
})

function entry() {
  return { client: 'codex', action: 'look' as const, source: 'Monitor', sourceKind: 'monitor' as const, changed: true, hash: '0'.repeat(16), bytes: 4, thumbnail: null, error: null }
}
