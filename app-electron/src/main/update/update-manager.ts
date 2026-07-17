import type { UpdateDownloadProgress, UpdatePrompt, UpdateStatus } from '../../shared/contracts'
import { appendUpdateLog, type UpdateLogEntry } from './update-log-store'
import type { UpdateResolution } from './update-runtime'

export interface UpdateCheckResult {
  available: boolean
  version: string | null
}

export interface UpdateAdapter {
  onProgress(listener: (progress: Omit<UpdateDownloadProgress, 'version'>) => void): () => void
  onDownloaded(listener: (version: string) => void): () => void
  onError(listener: (error: Error) => void): () => void
  check(): Promise<UpdateCheckResult>
  download(): Promise<void>
  install(): void
  dispose(): void
}

type CheckTrigger = 'background' | 'manual'
type StatusListener = (status: UpdateStatus) => void
type PromptListener = (prompt: UpdatePrompt) => void

export const UPDATE_INITIAL_DELAY_MS = 45_000
export const UPDATE_INSTALL_PAINT_MS = 250
export const UPDATE_SNOOZE_HOURS = [1, 2, 4, 12] as const

export class UpdateManager {
  private status: UpdateStatus
  private statusListeners = new Set<StatusListener>()
  private promptListeners = new Set<PromptListener>()
  private adapterUnsubscribers: (() => void)[] = []
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private started = false

  constructor(
    private resolution: UpdateResolution,
    private running: string,
    private adapter: UpdateAdapter | null,
    private logPath: string,
    private now: () => number = Date.now,
  ) {
    this.status = {
      ...resolution,
      running,
      phase: 'idle',
      progress: null,
      lastError: null,
      lastCheckAt: null,
      lastCheckOutcome: null,
      pendingVersion: null,
      snoozedUntil: 0,
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.log({ event: 'boot-resolution', channel: this.resolution.channel, running: this.running, reason: this.resolution.reason })
    if (this.resolution.channel === 'none') {
      this.log({ event: 'channel-none', channel: 'none', running: this.running, reason: this.resolution.reason })
      return
    } else if (this.resolution.channel !== 'github')
      throw new Error(`Unknown update channel: ${JSON.stringify(this.resolution.channel)}`)
    const adapter = this.requireAdapter()
    this.adapterUnsubscribers = [
      adapter.onProgress(progress => this.downloadProgress(progress)),
      adapter.onDownloaded(version => this.downloaded(version)),
      adapter.onError(error => this.adapterError(error)),
    ]
    if (!this.resolution.autoCheck) return
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      void this.check('background')
      this.intervalTimer = setInterval(() => void this.check('background'), this.resolution.checkIntervalMinutes * 60_000)
    }, UPDATE_INITIAL_DELAY_MS)
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.initialTimer = null
    this.intervalTimer = null
    for (const unsubscribe of this.adapterUnsubscribers.splice(0)) unsubscribe()
    this.adapter?.dispose()
    this.started = false
  }

  getStatus(): UpdateStatus {
    return structuredClone(this.status)
  }

  subscribe(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onPrompt(listener: PromptListener): () => void {
    this.promptListeners.add(listener)
    return () => this.promptListeners.delete(listener)
  }

  async check(trigger: CheckTrigger = 'manual'): Promise<UpdateStatus> {
    if (this.resolution.channel === 'none') {
      this.status.lastCheckAt = this.now()
      this.status.lastCheckOutcome = this.resolution.reason
      this.status.phase = 'idle'
      this.emit()
      this.log({ event: 'channel-none', channel: 'none', trigger, running: this.running, reason: this.resolution.reason })
      return this.getStatus()
    } else if (this.resolution.channel !== 'github')
      throw new Error(`Unknown update channel: ${JSON.stringify(this.resolution.channel)}`)
    if (this.status.phase === 'checking' || this.status.phase === 'downloading' || this.status.phase === 'ready' || this.status.phase === 'installing')
      return this.getStatus()
    this.status.phase = 'checking'
    this.status.progress = null
    this.status.lastError = null
    this.emit()
    try {
      const result = await this.requireAdapter().check()
      if (result.available && !result.version) throw new Error('Update feed reported an available update without a version')
      this.status.lastCheckAt = this.now()
      this.status.pendingVersion = result.available ? result.version : null
      this.status.lastCheckOutcome = result.available ? `found ${result.version}` : `up to date (${this.running})`
      this.status.phase = result.available ? 'available' : 'idle'
      this.log({ event: 'check', channel: 'github', trigger, running: this.running, found: result.available ? result.version : null })
      this.emit()
      if (result.available && result.version) this.offer(result.version, trigger)
    } catch (reason) {
      const error = toError(reason)
      this.status.lastCheckAt = this.now()
      this.status.lastCheckOutcome = `failed: ${error.message}`
      this.status.pendingVersion = null
      this.status.phase = trigger === 'manual' ? 'error' : 'idle'
      this.status.lastError = trigger === 'manual' ? error.message : null
      this.log({ event: 'error', channel: 'github', trigger, running: this.running, detail: `check failed: ${error.message}` })
      this.emit()
    }
    return this.getStatus()
  }

  async download(): Promise<UpdateStatus> {
    if (this.resolution.channel === 'none') throw new Error(this.resolution.reason)
    else if (this.resolution.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(this.resolution.channel)}`)
    const version = this.status.pendingVersion
    if (!version || (this.status.phase !== 'available' && this.status.phase !== 'error'))
      throw new Error(`No update is available to download (phase: ${this.status.phase})`)
    this.status.phase = 'downloading'
    this.status.lastError = null
    this.status.progress = { version, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
    this.log({ event: 'download-start', channel: 'github', running: this.running, found: version })
    this.emit()
    try { await this.requireAdapter().download() }
    catch (reason) { this.failDownload(toError(reason)) }
    return this.getStatus()
  }

  async install(): Promise<void> {
    if (this.resolution.channel === 'none') throw new Error(this.resolution.reason)
    else if (this.resolution.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(this.resolution.channel)}`)
    const version = this.status.pendingVersion
    if (!version || this.status.phase !== 'ready') throw new Error(`No downloaded update is ready (phase: ${this.status.phase})`)
    this.status.phase = 'installing'
    this.status.progress = null
    this.log({ event: 'install', channel: 'github', running: this.running, found: version })
    this.emit()
    await new Promise(resolve => setTimeout(resolve, UPDATE_INSTALL_PAINT_MS))
    try { this.requireAdapter().install() }
    catch (reason) {
      const error = toError(reason)
      this.status.phase = 'error'
      this.status.lastError = error.message
      this.log({ event: 'error', channel: 'github', detail: `install failed: ${error.message}` })
      this.emit()
      throw error
    }
  }

  snooze(hours: number): UpdateStatus {
    const accepted = UPDATE_SNOOZE_HOURS.includes(hours as (typeof UPDATE_SNOOZE_HOURS)[number]) ? hours : UPDATE_SNOOZE_HOURS[0]
    this.status.snoozedUntil = this.now() + accepted * 60 * 60_000
    this.log({ event: 'user-choice', channel: this.resolution.channel, running: this.running, detail: `snooze ${accepted}h` })
    this.emit()
    return this.getStatus()
  }

  private requireAdapter(): UpdateAdapter {
    if (!this.adapter) throw new Error('GitHub update adapter is not configured')
    return this.adapter
  }

  private downloadProgress(progress: Omit<UpdateDownloadProgress, 'version'>): void {
    if (this.status.phase !== 'downloading' || !this.status.pendingVersion) return
    this.status.progress = { version: this.status.pendingVersion, ...progress }
    this.emit()
  }

  private downloaded(version: string): void {
    if (this.status.phase !== 'downloading') return
    this.status.phase = 'ready'
    this.status.pendingVersion = version
    this.status.progress = null
    this.status.lastError = null
    this.log({ event: 'downloaded', channel: 'github', running: this.running, found: version })
    this.emit()
  }

  private adapterError(error: Error): void {
    if (this.status.phase === 'downloading') this.failDownload(error)
    else if (this.status.phase === 'installing') {
      this.status.phase = 'error'
      this.status.lastError = error.message
      this.log({ event: 'error', channel: 'github', running: this.running, found: this.status.pendingVersion, detail: `install failed: ${error.message}` })
      this.emit()
    }
  }

  private failDownload(error: Error): void {
    if (this.status.phase === 'error' && this.status.lastError === error.message) return
    this.status.phase = 'error'
    this.status.progress = null
    this.status.lastError = error.message
    this.log({ event: 'error', channel: 'github', running: this.running, found: this.status.pendingVersion, detail: `download failed: ${error.message}` })
    this.emit()
  }

  private offer(version: string, trigger: CheckTrigger): void {
    if (trigger === 'background' && this.status.snoozedUntil > this.now()) {
      this.log({ event: 'prompt-suppressed', channel: 'github', trigger, running: this.running, found: version, reason: `snoozed until ${new Date(this.status.snoozedUntil).toISOString()}` })
      return
    }
    const prompt = { version, running: this.running, trigger }
    for (const listener of this.promptListeners) listener(prompt)
    this.log({ event: 'prompt-shown', channel: 'github', trigger, running: this.running, found: version })
  }

  private emit(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) listener(status)
  }

  private log(entry: Omit<UpdateLogEntry, 'ts'>): void {
    try { appendUpdateLog(this.logPath, entry) }
    catch (error) { console.error('ScreenMCP update log failed', error) }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
