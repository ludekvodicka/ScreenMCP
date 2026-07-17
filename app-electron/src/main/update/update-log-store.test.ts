import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendUpdateLog, readUpdateLogTail } from './update-log-store'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('update log store', () => {
  it('appends, reads the newest entries, and tolerates a missing file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-log-'))
    directories.push(directory)
    const path = join(directory, 'nested', 'update-log.jsonl')
    expect(readUpdateLogTail(path)).toEqual([])
    appendUpdateLog(path, { event: 'boot-resolution', channel: 'github', reason: 'installed' })
    appendUpdateLog(path, { event: 'check', channel: 'github', found: '0.2.0' })
    expect(readUpdateLogTail(path)).toHaveLength(2)
    expect(readUpdateLogTail(path, 1)[0]).toMatchObject({ event: 'check', found: '0.2.0' })
  })

  it('trims an oversized log on whole parseable lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-log-'))
    directories.push(directory)
    const path = join(directory, 'update-log.jsonl')
    for (let index = 0; index < 4_000; index++)
      appendUpdateLog(path, { event: 'check', channel: 'github', detail: `${index}:${'x'.repeat(200)}` })
    const entries = readUpdateLogTail(path, 10_000)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.length).toBeLessThan(4_000)
    expect(entries.at(-1)?.detail).toContain('3999:')
  })

  it('skips malformed historical lines', () => {
    const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-log-'))
    directories.push(directory)
    const path = join(directory, 'update-log.jsonl')
    writeFileSync(path, `not json\n${JSON.stringify({ ts: 1, event: 'check', channel: 'github' })}\n{broken\n`)
    expect(readUpdateLogTail(path)).toEqual([{ ts: 1, event: 'check', channel: 'github' }])
  })
})
