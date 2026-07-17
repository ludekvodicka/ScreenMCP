import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateDownloadProgress } from '../../shared/contracts'
import { readUpdateLogTail } from './update-log-store'
import { UPDATE_INITIAL_DELAY_MS, UPDATE_INSTALL_PAINT_MS, UpdateManager, type UpdateAdapter, type UpdateCheckResult } from './update-manager'

class FakeAdapter implements UpdateAdapter {
  checks: (UpdateCheckResult | Error)[] = []
  checkCount = 0
  downloadCount = 0
  installCount = 0
  installError: Error | null = null
  disposed = false
  private progressListeners = new Set<(progress: Omit<UpdateDownloadProgress, 'version'>) => void>()
  private downloadedListeners = new Set<(version: string) => void>()
  private errorListeners = new Set<(error: Error) => void>()

  onProgress(listener: (progress: Omit<UpdateDownloadProgress, 'version'>) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  onDownloaded(listener: (version: string) => void): () => void {
    this.downloadedListeners.add(listener)
    return () => this.downloadedListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  check(): Promise<UpdateCheckResult> {
    this.checkCount++
    const result = this.checks.shift() ?? { available: false, version: null }
    if (result instanceof Error) return Promise.reject(result)
    return Promise.resolve(result)
  }

  download(): Promise<void> { this.downloadCount++; return Promise.resolve() }
  install(): void {
    this.installCount++
    if (this.installError) this.error(this.installError)
  }
  dispose(): void { this.disposed = true }
  progress(progress: Omit<UpdateDownloadProgress, 'version'>): void {
    for (const listener of this.progressListeners) listener(progress)
  }
  downloaded(version: string): void {
    for (const listener of this.downloadedListeners) listener(version)
  }
  error(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

const directories: string[] = []

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function create(adapter: FakeAdapter, now: () => number = () => Date.now()): { manager: UpdateManager; log: string } {
  const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-manager-'))
  directories.push(directory)
  const log = join(directory, 'update-log.jsonl')
  const manager = new UpdateManager(
    { channel: 'github', reason: 'installed', autoCheck: true, checkIntervalMinutes: 120 },
    '0.1.0',
    adapter,
    log,
    now,
  )
  return { manager, log }
}

describe('UpdateManager', () => {
  it('checks without downloading, then requires explicit download and restart', async () => {
    const adapter = new FakeAdapter()
    adapter.checks.push({ available: true, version: '0.2.0' })
    const { manager, log } = create(adapter)
    const prompts: string[] = []
    manager.onPrompt(prompt => prompts.push(prompt.version))
    manager.start()

    await manager.check()
    expect(manager.getStatus()).toMatchObject({ phase: 'available', pendingVersion: '0.2.0' })
    expect(adapter.downloadCount).toBe(0)
    expect(prompts).toEqual(['0.2.0'])

    await manager.download()
    expect(adapter.downloadCount).toBe(1)
    expect(manager.getStatus().phase).toBe('downloading')
    adapter.progress({ percent: 41.6, transferred: 42, total: 100, bytesPerSecond: 12 })
    expect(manager.getStatus().progress?.percent).toBe(41.6)
    adapter.downloaded('0.2.0')
    expect(manager.getStatus().phase).toBe('ready')
    expect(adapter.installCount).toBe(0)

    const installing = manager.install()
    expect(manager.getStatus().phase).toBe('installing')
    await vi.advanceTimersByTimeAsync(UPDATE_INSTALL_PAINT_MS)
    await installing
    expect(adapter.installCount).toBe(1)
    expect(readUpdateLogTail(log).map(entry => entry.event)).toEqual(expect.arrayContaining(['boot-resolution', 'check', 'download-start', 'downloaded', 'install']))
    manager.stop()
  })

  it('keeps background failures quiet and makes manual failures visible', async () => {
    const adapter = new FakeAdapter()
    adapter.checks.push(new Error('offline'), new Error('still offline'))
    const { manager } = create(adapter)
    manager.start()
    await manager.check('background')
    expect(manager.getStatus()).toMatchObject({ phase: 'idle', lastError: null, lastCheckOutcome: 'failed: offline' })
    await manager.check('manual')
    expect(manager.getStatus()).toMatchObject({ phase: 'error', lastError: 'still offline' })
    manager.stop()
  })

  it('rejects malformed available results and exposes installer event failures', async () => {
    const adapter = new FakeAdapter()
    adapter.checks.push({ available: true, version: null }, { available: true, version: '0.2.0' })
    const { manager } = create(adapter)
    manager.start()
    await manager.check('manual')
    expect(manager.getStatus()).toMatchObject({ phase: 'error', lastError: 'Update feed reported an available update without a version' })
    await manager.check('manual')
    await manager.download()
    adapter.downloaded('0.2.0')
    adapter.installError = new Error('installer blocked')
    const installing = manager.install()
    await vi.advanceTimersByTimeAsync(UPDATE_INSTALL_PAINT_MS)
    await installing
    expect(manager.getStatus()).toMatchObject({ phase: 'error', lastError: 'installer blocked' })
    manager.stop()
  })

  it('keeps the pending version actionable after a download error and retries explicitly', async () => {
    const adapter = new FakeAdapter()
    adapter.checks.push({ available: true, version: '0.2.0' })
    const { manager } = create(adapter)
    manager.start()
    await manager.check()
    await manager.download()
    adapter.error(new Error('connection reset'))
    expect(manager.getStatus()).toMatchObject({ phase: 'error', pendingVersion: '0.2.0', lastError: 'connection reset' })
    await manager.download()
    expect(adapter.downloadCount).toBe(2)
    adapter.downloaded('0.2.0')
    expect(manager.getStatus()).toMatchObject({ phase: 'ready', lastError: null })
    manager.stop()
  })

  it('suppresses snoozed background prompts but manual checks bypass snooze', async () => {
    const adapter = new FakeAdapter()
    adapter.checks.push({ available: true, version: '0.2.0' }, { available: true, version: '0.2.0' })
    let now = 1_000
    const { manager, log } = create(adapter, () => now)
    const prompts: string[] = []
    manager.onPrompt(prompt => prompts.push(prompt.version))
    manager.start()
    expect(manager.snooze(99).snoozedUntil).toBe(now + 60 * 60_000)
    await manager.check('background')
    expect(prompts).toEqual([])
    await manager.check('manual')
    expect(prompts).toEqual(['0.2.0'])
    expect(readUpdateLogTail(log).some(entry => entry.event === 'prompt-suppressed')).toBe(true)
    now += 2 * 60 * 60_000
    manager.stop()
  })

  it('starts background polling after the initial delay and disposes timers and adapter', async () => {
    const adapter = new FakeAdapter()
    const { manager } = create(adapter)
    manager.start()
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS - 1)
    expect(adapter.checkCount).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(adapter.checkCount).toBe(1)
    manager.stop()
    await vi.advanceTimersByTimeAsync(120 * 60_000)
    expect(adapter.checkCount).toBe(1)
    expect(adapter.disposed).toBe(true)
  })

  it('does not schedule automatic checks when the knob is disabled', async () => {
    const adapter = new FakeAdapter()
    const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-manager-'))
    directories.push(directory)
    const manager = new UpdateManager(
      { channel: 'github', reason: 'installed', autoCheck: false, checkIntervalMinutes: 120 },
      '0.1.0',
      adapter,
      join(directory, 'update-log.jsonl'),
    )
    manager.start()
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS + 120 * 60_000)
    expect(adapter.checkCount).toBe(0)
    manager.stop()
  })

  it('reports disabled runtimes without requiring an adapter', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'screenmcp-update-manager-'))
    directories.push(directory)
    const manager = new UpdateManager(
      { channel: 'none', reason: 'development', autoCheck: true, checkIntervalMinutes: 120 },
      '0.1.0',
      null,
      join(directory, 'update-log.jsonl'),
    )
    manager.start()
    await manager.check()
    expect(manager.getStatus()).toMatchObject({ channel: 'none', phase: 'idle', lastCheckOutcome: 'development' })
    await expect(manager.download()).rejects.toThrow('development')
    manager.stop()
  })
})
