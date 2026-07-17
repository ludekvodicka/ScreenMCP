import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, type DesktopCapturerSource } from 'electron'
import type {
  CaptureWorkerRequest,
  CaptureWorkerResponse,
  CaptureWorkerResult,
  RawCaptureFrame,
} from '../shared/contracts'
import { smokeLog } from './smoke-log'
import { validateTrustedWindowCapture, type TrustedWindowCaptureSource } from './trusted-window-capture'

interface PendingRequest {
  resolve: (result: CaptureWorkerResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class CaptureStream {
  private window: BrowserWindow | null = null
  private sourceId: string | null = null
  private trustedWindowSource: TrustedWindowCaptureSource | null = null
  private pending = new Map<string, PendingRequest>()
  private ready: Promise<void> | null = null
  private operation: Promise<unknown> = Promise.resolve()
  private listening = false
  private readonly onResponse = (_event: Electron.IpcMainEvent, response: CaptureWorkerResponse): void => {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.ok && response.result) pending.resolve(response.result)
    else pending.reject(new Error(response.error ?? 'Capture worker request failed'))
  }

  async initialize(): Promise<void> {
    if (this.ready && this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) return this.ready
    if (!this.listening) {
      ipcMain.on('capture-worker:response', this.onResponse)
      this.listening = true
    }
    this.ready = this.createWorker()
    try {
      return await this.ready
    } catch (error) {
      this.ready = null
      throw error
    }
  }

  async start(sourceId: string, trustedWindowSource?: TrustedWindowCaptureSource): Promise<{ width: number; height: number }> {
    return this.enqueue(async () => {
      const trusted = trustedWindowSource ? validateTrustedWindowCapture(sourceId, trustedWindowSource, process.platform) : null
      await this.initialize()
      this.sourceId = sourceId
      this.trustedWindowSource = trusted
      const result = await this.request({ kind: 'start', requestId: randomUUID() })
      if (result.kind === 'started') return { width: result.width, height: result.height }
      else if (result.kind === 'stopped' || result.kind === 'frame') throw new Error(`Unexpected start response: ${result.kind}`)
      else throw new Error(`Unknown capture response: ${JSON.stringify(result)}`)
    })
  }

  async stop(): Promise<void> {
    await this.enqueue(async () => {
      try {
        if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
        const result = await this.request({ kind: 'stop', requestId: randomUUID() })
        if (result.kind !== 'stopped') throw new Error(`Unexpected stop response: ${result.kind}`)
      } finally {
        this.sourceId = null
        this.trustedWindowSource = null
      }
    })
  }

  async grabFrame(): Promise<RawCaptureFrame> {
    return this.enqueue(async () => {
      try {
        return await this.grabOnce()
      } catch (firstError) {
        try {
          await this.restartSelectedSource()
          return await this.grabOnce()
        } catch (recoveryError) {
          throw new Error(`Capture stream recovery failed after ${firstError instanceof Error ? firstError.message : String(firstError)}`, { cause: recoveryError })
        }
      }
    })
  }

  async dispose(): Promise<void> {
    await this.stop().catch(() => undefined)
    if (this.listening) ipcMain.off('capture-worker:response', this.onResponse)
    this.listening = false
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Capture worker disposed'))
    }
    this.pending.clear()
    this.window?.destroy()
    this.window = null
    this.ready = null
  }

  private async createWorker(): Promise<void> {
    smokeLog('capture worker create begin')
    const window = new BrowserWindow({
      width: 2,
      height: 2,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        preload: join(import.meta.dirname, '../preload/capture.cjs'),
      },
    })
    this.window = window
    smokeLog('capture worker window created')
    window.webContents.on('render-process-gone', (_event, details) => this.invalidateWorker(window, new Error(`Capture worker renderer exited: ${details.reason}`)))
    window.on('closed', () => this.invalidateWorker(window, new Error('Capture worker window closed')))
    if (process.env.SCREENMCP_CAPTURE_SMOKE) {
      window.webContents.on('console-message', details => smokeLog(`worker console: ${details.message}`))
      window.webContents.on('did-fail-load', (_event, code, description) => smokeLog(`worker load failed ${code}: ${description}`))
    }
    window.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      void this.resolveSource().then(source => callback({ video: source })).catch(error => {
        console.error('Display media selection failed', error)
        callback({})
      })
    })
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    if (developmentUrl && !app.isPackaged) await window.loadURL(`${developmentUrl}/capture.html`)
    else await window.loadFile(join(import.meta.dirname, '../renderer/capture.html'))
    smokeLog('capture worker page loaded')
  }

  private async resolveSource(): Promise<DesktopCapturerSource> {
    if (!this.sourceId) throw new Error('No capture source selected')
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
    const source = this.sourceId === 'portal' ? sources[0] : sources.find(candidate => candidate.id === this.sourceId)
    if (source) return source
    if (!this.trustedWindowSource) throw new Error(`Capture source no longer exists: ${this.sourceId}`)
    const trusted = validateTrustedWindowCapture(this.sourceId, this.trustedWindowSource, process.platform)
    return { id: trusted.id, name: trusted.name, thumbnail: nativeImage.createEmpty(), display_id: '', appIcon: nativeImage.createEmpty() }
  }

  private request(request: CaptureWorkerRequest): Promise<CaptureWorkerResult> {
    const window = this.window
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.reject(new Error('Capture worker is not available'))
    return new Promise((resolve, reject) => {
      smokeLog(`capture request ${request.kind}`)
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error(`Capture worker timed out: ${request.kind}`))
      }, request.kind === 'start' ? 120_000 : 15_000)
      this.pending.set(request.requestId, { resolve, reject, timer })
      window.webContents.send('capture-worker:request', request)
    })
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.operation.then(run, run)
    this.operation = next.catch(() => undefined)
    return next
  }

  private async grabOnce(): Promise<RawCaptureFrame> {
    const result = await this.request({ kind: 'grab', requestId: randomUUID() })
    if (result.kind === 'frame') return result
    else if (result.kind === 'started' || result.kind === 'stopped') throw new Error(`Unexpected frame response: ${result.kind}`)
    else throw new Error(`Unknown capture response: ${JSON.stringify(result)}`)
  }

  private async restartSelectedSource(): Promise<void> {
    const sourceId = this.sourceId
    if (!sourceId) throw new Error('No capture source is available for recovery')
    await this.initialize()
    this.sourceId = sourceId
    const result = await this.request({ kind: 'start', requestId: randomUUID() })
    if (result.kind === 'started') return
    else if (result.kind === 'stopped' || result.kind === 'frame') throw new Error(`Unexpected recovery response: ${result.kind}`)
    else throw new Error(`Unknown capture response: ${JSON.stringify(result)}`)
  }

  private invalidateWorker(window: BrowserWindow, error: Error): void {
    if (this.window !== window) return
    this.window = null
    this.ready = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
