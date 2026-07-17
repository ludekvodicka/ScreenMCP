import { Worker } from 'node:worker_threads'
import type { Rect } from '../../../core/mcp/src/control'
import type { ToolErrorCode } from '../../../core/mcp/src/contract'
import { ScreenMcpError } from '../../../core/mcp/src/errors'

export interface RawElement {
  ref: string
  runtimeId: number[]
  controlType: number
  role: string
  name: string
  value?: string
  enabled: boolean
  bounds: Rect
}

export type UiaWorkerRequest =
  | { requestId: string; action: 'enumerate'; hwnd: number }
  | { requestId: string; action: 'snapshot'; hwnd: number; ref: string }
  | { requestId: string; action: 'invoke'; hwnd: number; ref: string; scope?: Rect }
  | { requestId: string; action: 'getValue'; hwnd: number; ref: string; scope?: Rect }
  | { requestId: string; action: 'setValue'; hwnd: number; ref: string; text: string; scope?: Rect }
  | { requestId: string; action: 'focus'; hwnd: number; ref: string; scope?: Rect }
  | { requestId: string; action: 'clear' }
  | { requestId: string; action: 'dispose' }

export interface UiaWorkerResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: { code: ToolErrorCode; message: string }
}

interface WorkerPort {
  postMessage(message: UiaWorkerRequest): void
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  terminate(): Promise<number>
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface UiaClientOptions {
  platform?: NodeJS.Platform
  timeoutMs?: number
  workerFactory?: () => WorkerPort
}

export class UiaClient {
  private worker: WorkerPort | null = null
  private pending = new Map<string, PendingCall>()
  private sequence = 0
  private disposing = false
  private platform: NodeJS.Platform
  private timeoutMs: number
  private workerFactory: () => WorkerPort

  constructor(options: UiaClientOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.workerFactory = options.workerFactory ?? (() => new Worker(new URL('./uia-worker.js', import.meta.url)))
  }

  enumerate(hwnd: number): Promise<{ elements: RawElement[]; truncated: boolean }> {
    return this.call('enumerate', { hwnd })
  }

  snapshot(hwnd: number, ref: string): Promise<RawElement | null> {
    return this.call('snapshot', { hwnd, ref })
  }

  async invoke(hwnd: number, ref: string, scope?: Rect): Promise<void> {
    await this.call('invoke', { hwnd, ref, scope })
  }

  getValue(hwnd: number, ref: string, scope?: Rect): Promise<string> {
    return this.call('getValue', { hwnd, ref, scope })
  }

  async setValue(hwnd: number, ref: string, text: string, scope?: Rect): Promise<void> {
    await this.call('setValue', { hwnd, ref, text, scope })
  }

  async focus(hwnd: number, ref: string, scope?: Rect): Promise<void> {
    await this.call('focus', { hwnd, ref, scope })
  }

  async clear(): Promise<void> {
    if (!this.worker) return
    await this.call('clear', {})
  }

  async dispose(): Promise<void> {
    if (this.disposing) return
    this.disposing = true
    const worker = this.worker
    if (!worker) return
    try { await this.call('dispose', {}, true) }
    catch { await worker.terminate().catch(() => undefined) }
    finally {
      this.worker = null
      this.rejectPending(new ScreenMcpError('control_unavailable', 'UI Automation shut down'))
    }
  }

  private call<T>(action: UiaWorkerRequest['action'], payload: Record<string, unknown>, allowDisposing = false): Promise<T> {
    if (this.platform !== 'win32') return Promise.reject(new ScreenMcpError('control_unavailable', 'Interactive control is available on Windows only'))
    if (this.disposing && !allowDisposing) return Promise.reject(new ScreenMcpError('control_unavailable', 'UI Automation is shutting down'))
    const worker = this.ensureWorker()
    const requestId = `uia-${++this.sequence}`
    const request = { requestId, action, ...payload } as UiaWorkerRequest
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.handleTimeout(requestId, action), this.timeoutMs)
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timer })
      try { worker.postMessage(request) }
      catch (error) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(unavailable(error))
      }
    })
  }

  private handleTimeout(requestId: string, action: UiaWorkerRequest['action']): void {
    const pending = this.pending.get(requestId)
    this.pending.delete(requestId)
    const worker = this.worker
    this.worker = null
    if (worker) void worker.terminate().catch(() => undefined)
    if (pending) pending.reject(new ScreenMcpError('control_unavailable', `UI Automation timed out during ${action}`))
    this.rejectPending(new ScreenMcpError('control_unavailable', 'UI Automation worker was reset after a timeout'))
  }

  private ensureWorker(): WorkerPort {
    if (this.worker) return this.worker
    const worker = this.workerFactory()
    worker.on('message', message => this.handleMessage(message))
    worker.on('error', error => this.handleWorkerFailure(error))
    worker.on('exit', code => {
      if (this.worker === worker) this.worker = null
      if (!this.disposing || code !== 0) this.rejectPending(new ScreenMcpError('control_unavailable', `UI Automation worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: unknown): void {
    if (!isResponse(message)) return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.requestId)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new ScreenMcpError(message.error?.code ?? 'control_unavailable', message.error?.message ?? 'UI Automation failed'))
  }

  private handleWorkerFailure(error: Error): void {
    const worker = this.worker
    this.worker = null
    this.rejectPending(unavailable(error))
    if (worker) void worker.terminate().catch(() => undefined)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function isResponse(value: unknown): value is UiaWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<UiaWorkerResponse>
  return typeof response.requestId === 'string' && typeof response.ok === 'boolean'
}

function unavailable(error: unknown): ScreenMcpError {
  return new ScreenMcpError('control_unavailable', error instanceof Error ? error.message : String(error))
}
