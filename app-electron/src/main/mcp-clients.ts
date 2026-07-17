import type { AppState } from './app-state'

interface ClientPresence {
  client: string
  lastSeen: number
  streams: number
}

export interface McpClientsOptions {
  leaseMs?: number
  sweepMs?: number
  now?: () => number
}

export class McpClients {
  private sessions = new Map<string, ClientPresence>()
  private flashTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout
  private capturing = false
  private lastState = ''
  private leaseMs: number
  private now: () => number

  constructor(private appState: AppState, options: McpClientsOptions = {}) {
    this.leaseMs = options.leaseMs ?? 60_000
    this.now = options.now ?? Date.now
    this.sweepTimer = setInterval(() => this.refresh(), options.sweepMs ?? 5_000)
    this.sweepTimer.unref()
  }

  connected(sessionId: string, client: string): void {
    this.sessions.set(sessionId, { client, lastSeen: this.now(), streams: 0 })
    this.refresh()
  }

  activity(sessionId: string, client: string): void {
    const current = this.sessions.get(sessionId)
    this.sessions.set(sessionId, { client, lastSeen: this.now(), streams: current?.streams ?? 0 })
    this.refresh()
  }

  streamOpened(sessionId: string, client: string): void {
    const current = this.sessions.get(sessionId)
    this.sessions.set(sessionId, { client, lastSeen: this.now(), streams: (current?.streams ?? 0) + 1 })
    this.refresh()
  }

  streamClosed(sessionId: string): void {
    const current = this.sessions.get(sessionId)
    if (!current) return
    const streams = Math.max(0, current.streams - 1)
    this.sessions.set(sessionId, { ...current, lastSeen: streams === 0 ? Number.NEGATIVE_INFINITY : current.lastSeen, streams })
    this.refresh()
  }

  disconnected(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.refresh()
  }

  names(): string[] {
    const now = this.now()
    return [...new Set([...this.sessions.values()].filter(session => session.streams > 0 || now - session.lastSeen <= this.leaseMs).map(session => session.client))].sort()
  }

  noteLook(): void {
    this.capturing = true
    this.refresh()
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null
      this.capturing = false
      this.refresh()
    }, 1_500)
  }

  dispose(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer)
    clearInterval(this.sweepTimer)
    this.flashTimer = null
    this.sessions.clear()
    this.capturing = false
    this.refresh()
  }

  private refresh(): void {
    const clients = this.names()
    const state = this.capturing
      ? { kind: 'capturing' as const, clients }
      : clients.length > 0
        ? { kind: 'connected' as const, clients }
        : clients.length === 0
          ? { kind: 'disconnected' as const }
          : null
    if (!state) throw new Error(`Invalid client count: ${clients.length}`)
    const serialized = JSON.stringify(state)
    if (serialized === this.lastState) return
    this.lastState = serialized
    this.appState.setCaptureState(state)
  }
}
