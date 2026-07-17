import { randomUUID } from 'node:crypto'
import type { AppState } from './app-state'
import type { CaptureController } from './capture-controller'
import type { InteractiveRequest, InteractiveRequestDecision, InteractiveWriteAction, SourceSelection } from '../shared/contracts'
import { sourceKey } from './settings-store'
import { publish } from './streams'
import { revealMainWindow, type MainWindowReveal } from './window'

interface Waiter {
  id: number
  client: string
  action: InteractiveWriteAction
  signal: AbortSignal | undefined
  onAbort: (() => void) | null
  resolve: (allowed: boolean) => void
}

interface ActiveRequest {
  id: string
  source: string
  sourceKey: string
  waiters: Map<number, Waiter>
  timer: NodeJS.Timeout | null
  reveal: MainWindowReveal
}

export interface InteractiveRequestInput {
  client: string
  action: InteractiveWriteAction
  selection: SourceSelection
}

export interface InteractiveRequestGate {
  request(input: InteractiveRequestInput, signal?: AbortSignal): Promise<boolean>
}

export interface InteractiveRequestServiceOptions {
  timeoutMs?: number
  reveal?: () => MainWindowReveal
}

export class InteractiveRequestService implements InteractiveRequestGate {
  private active: ActiveRequest | null = null
  private nextWaiterId = 1
  private timeoutMs: number
  private reveal: () => MainWindowReveal
  private unsubscribeCapture: () => void
  private unsubscribeState: () => void

  constructor(capture: CaptureController, appState: AppState, options: InteractiveRequestServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.reveal = options.reveal ?? revealMainWindow
    this.unsubscribeCapture = capture.subscribe(() => { void this.cancel() })
    this.unsubscribeState = appState.subscribe(snapshot => { if (snapshot.stopped) void this.cancel() })
  }

  request(input: InteractiveRequestInput, signal?: AbortSignal): Promise<boolean> {
    assertWriteAction(input.action)
    if (signal?.aborted) return Promise.resolve(false)
    const key = sourceKey(input.selection)
    if (this.active && this.active.sourceKey !== key) void this.cancel()
    if (!this.active) this.active = this.createActive(input.selection, key)
    const active = this.active
    return new Promise(resolve => {
      const id = this.nextWaiterId++
      const waiter: Waiter = { id, client: input.client, action: input.action, signal, onAbort: null, resolve }
      if (signal) {
        waiter.onAbort = () => this.abortWaiter(active, id)
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      active.waiters.set(id, waiter)
      this.publish()
    })
  }

  listPending(): InteractiveRequest[] {
    const active = this.active
    if (!active) return []
    const waiter = active.waiters.values().next().value
    if (!waiter) return []
    return [{ id: active.id, client: waiter.client, action: waiter.action, source: active.source }]
  }

  async respond(id: string, decision: InteractiveRequestDecision, enableInteractive: () => void): Promise<void> {
    const active = this.active
    if (!active || active.id !== id) throw new Error('Interactive request has expired')
    if (decision === 'keep-read-only') await this.settle(active, false)
    else if (decision === 'enable-interactive') {
      enableInteractive()
      await this.settle(active, true)
    } else
      throw new Error(`Unknown interactive request decision: ${JSON.stringify(decision)}`)
  }

  async dispose(): Promise<void> {
    this.unsubscribeCapture()
    this.unsubscribeState()
    await this.cancel()
  }

  private createActive(selection: SourceSelection, key: string): ActiveRequest {
    const reveal = this.reveal()
    const active: ActiveRequest = {
      id: randomUUID(),
      source: selection.label,
      sourceKey: key,
      waiters: new Map<number, Waiter>(),
      timer: null,
      reveal,
    }
    active.timer = setTimeout(() => { void this.settle(active, false) }, this.timeoutMs)
    return active
  }

  private abortWaiter(active: ActiveRequest, id: number): void {
    if (this.active !== active) return
    const waiter = active.waiters.get(id)
    if (!waiter) return
    active.waiters.delete(id)
    this.detach(waiter)
    waiter.resolve(false)
    if (!active.waiters.size) void this.settle(active, false)
    else this.publish()
  }

  private async cancel(): Promise<void> {
    const active = this.active
    if (active) await this.settle(active, false)
  }

  private async settle(active: ActiveRequest, allowed: boolean): Promise<void> {
    if (this.active !== active) return
    this.active = null
    if (active.timer) clearTimeout(active.timer)
    active.timer = null
    this.publish()
    await active.reveal.restore().catch(() => undefined)
    for (const waiter of active.waiters.values()) {
      this.detach(waiter)
      waiter.resolve(allowed && waiter.signal?.aborted !== true)
    }
    active.waiters.clear()
  }

  private detach(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.onAbort = null
  }

  private publish(): void {
    publish('interactive:requests', this.listPending())
  }
}

function assertWriteAction(action: InteractiveWriteAction): void {
  if (action === 'click') return
  else if (action === 'type_text') return
  else
    throw new Error(`Unknown interactive write action: ${JSON.stringify(action)}`)
}
