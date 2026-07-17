import { join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, type Display } from 'electron'
import type { PickerMode, PickerOverlayState, Rect, SourceSelection } from '../shared/contracts'
import type { CaptureController } from './capture-controller'
import { openNativeWindows } from './native-window-enum'
import { isWayland } from './source-enum'
import { matchWindowTargets, rectangleChoice, windowAtPoint, windowsInSnapshotOrder, type NativeWindowMetadata, type Point, type WindowTarget } from './source-picker-geometry'
import { getMainWindow, showMainWindow } from './window'

interface MonitorTarget {
  captureId: string
  label: string
  display: Display
}

interface PickerOverlay {
  window: BrowserWindow
  display: Display
}

interface PickerSession {
  mode: PickerMode
  overlays: Map<number, PickerOverlay>
  monitors: Map<string, MonitorTarget>
  targets: WindowTarget[]
  targetOrder: string[]
  activeTargetId: string | null
  refreshTimer: NodeJS.Timeout | null
  refreshing: Promise<void> | null
  choosing: boolean
  completed: boolean
  resolve: (selection: SourceSelection | null) => void
}

export class DesktopSourcePicker {
  private session: PickerSession | null = null

  constructor(private capture: CaptureController) {
    ipcMain.on('picker:pointer', this.onPointer)
    ipcMain.on('picker:select-window', this.onSelectWindow)
    ipcMain.on('picker:select-rectangle', this.onSelectRectangle)
    ipcMain.on('picker:cancel', this.onCancel)
    screen.on('display-added', this.onDisplayChanged)
    screen.on('display-removed', this.onDisplayChanged)
    screen.on('display-metrics-changed', this.onDisplayChanged)
  }

  async pick(mode: PickerMode): Promise<SourceSelection | null> {
    const pickerMode = validatedPickerMode(mode)
    if (isWayland()) throw new Error('Desktop overlays are unavailable on Wayland; use the system portal picker')
    if (this.session) throw new Error('Another source picker is already open')
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('The ScreenMCP window is unavailable')
    const displays = screen.getAllDisplays()
    if (displays.length === 0) throw new Error('No displays are available')
    const monitors = await this.monitorTargets(displays)
    let targets: WindowTarget[]
    if (pickerMode === 'window') targets = await this.windowTargets()
    else if (pickerMode === 'rectangle') targets = []
    else throw new Error(`Unknown picker mode: ${JSON.stringify(pickerMode)}`)
    const wasVisible = mainWindow.isVisible()
    let resolve!: (selection: SourceSelection | null) => void
    const result = new Promise<SourceSelection | null>(done => { resolve = done })
    const session: PickerSession = {
      mode: pickerMode,
      overlays: new Map(),
      monitors,
      targets,
      targetOrder: targets.map(target => target.id),
      activeTargetId: null,
      refreshTimer: null,
      refreshing: null,
      choosing: false,
      completed: false,
      resolve,
    }
    this.session = session
    try {
      mainWindow.hide()
      await this.createOverlays(session, displays)
      if (pickerMode === 'window') {
        session.refreshTimer = setInterval(() => void this.refreshWindowTargets(session).catch(error => this.sendError(session, error instanceof Error ? error.message : String(error))), 250)
        session.refreshTimer.unref()
      } else if (pickerMode !== 'rectangle') throw new Error(`Unknown picker mode: ${JSON.stringify(pickerMode)}`)
      return await result
    } finally {
      this.cleanupSession(session)
      if (wasVisible) showMainWindow()
    }
  }

  dispose(): void {
    this.finish(this.session, null)
    if (this.session) this.cleanupSession(this.session)
    ipcMain.off('picker:pointer', this.onPointer)
    ipcMain.off('picker:select-window', this.onSelectWindow)
    ipcMain.off('picker:select-rectangle', this.onSelectRectangle)
    ipcMain.off('picker:cancel', this.onCancel)
    screen.off('display-added', this.onDisplayChanged)
    screen.off('display-removed', this.onDisplayChanged)
    screen.off('display-metrics-changed', this.onDisplayChanged)
  }

  private readonly onPointer = (event: Electron.IpcMainEvent, value: unknown): void => {
    const session = this.session
    const overlay = session ? session.overlays.get(event.sender.id) : undefined
    const point = validPoint(value)
    if (!session || session.mode !== 'window' || !overlay || !point) return
    const target = windowAtPoint(session.targets, globalPoint(overlay.display, point))
    const targetId = target?.id ?? null
    if (targetId === session.activeTargetId) return
    session.activeTargetId = targetId
    this.broadcast(session, { kind: 'target', target })
  }

  private readonly onSelectWindow = (event: Electron.IpcMainEvent, value: unknown): void => {
    const session = this.session
    const overlay = session ? session.overlays.get(event.sender.id) : undefined
    const point = validPoint(value)
    if (!session || session.mode !== 'window' || !overlay || !point || session.choosing) return
    session.choosing = true
    void this.chooseWindow(session, globalPoint(overlay.display, point)).finally(() => { session.choosing = false })
  }

  private readonly onSelectRectangle = (event: Electron.IpcMainEvent, firstValue: unknown, lastValue: unknown): void => {
    const session = this.session
    const overlay = session ? session.overlays.get(event.sender.id) : undefined
    const first = validPoint(firstValue)
    const last = validPoint(lastValue)
    if (!session || session.mode !== 'rectangle' || !overlay || !first || !last || session.choosing) return
    session.choosing = true
    void this.chooseRectangle(session, overlay.display, first, last).finally(() => { session.choosing = false })
  }

  private readonly onCancel = (event: Electron.IpcMainEvent): void => {
    const session = this.session
    if (!session || !session.overlays.has(event.sender.id)) return
    if (session.choosing) { this.sendError(session, 'Finishing the current selection…'); return }
    this.finish(session, null)
  }

  private readonly onDisplayChanged = (): void => {
    if (this.session) this.finish(this.session, null)
  }

  private async chooseWindow(session: PickerSession, point: Point): Promise<void> {
    try {
      await this.refreshWindowTargets(session)
      if (session.completed) return
      const target = windowAtPoint(session.targets, point)
      if (!target) { this.sendError(session, 'This window is not available for capture.'); return }
      const selection = await this.capture.select({ captureId: target.id, kind: 'window', label: target.label })
      this.finish(session, selection)
    } catch (error) {
      this.sendError(session, error instanceof Error ? error.message : String(error))
    }
  }

  private async chooseRectangle(session: PickerSession, display: Display, first: Point, last: Point): Promise<void> {
    try {
      const monitor = session.monitors.get(String(display.id))
      if (!monitor) { this.sendError(session, 'This display is not available for capture.'); return }
      const choice = rectangleChoice(first, last, { width: display.bounds.width, height: display.bounds.height })
      if (!choice) { this.sendError(session, 'Drag a rectangle at least 12 × 12 pixels.'); return }
      let selection: SourceSelection
      if (choice.kind === 'region') selection = await this.capture.selectNormalizedRegion(monitor.captureId, `${monitor.label} · region`, choice.region, String(monitor.display.id))
      else throw new Error(`Unknown rectangle choice: ${JSON.stringify(choice)}`)
      this.finish(session, selection)
    } catch (error) {
      this.sendError(session, error instanceof Error ? error.message : String(error))
    }
  }

  private async createOverlays(session: PickerSession, displays: Display[]): Promise<void> {
    await Promise.all(displays.map(async display => {
      const window = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          preload: join(import.meta.dirname, '../preload/picker.cjs'),
        },
      })
      session.overlays.set(window.webContents.id, { window, display })
      window.on('closed', () => { if (!session.completed) this.finish(session, null) })
      window.setAlwaysOnTop(true, 'screen-saver')
      window.setContentProtection(true)
      if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
      else if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error(`Unsupported picker platform: ${JSON.stringify(process.platform)}`)
      const developmentUrl = process.env.ELECTRON_RENDERER_URL
      if (developmentUrl && !app.isPackaged) await window.loadURL(new URL('/picker.html', developmentUrl).href)
      else await window.loadFile(join(import.meta.dirname, '../renderer/picker.html'))
      window.webContents.send('picker:state', { kind: 'config', mode: session.mode, displayId: String(display.id), displayBounds: display.bounds })
      window.show()
    }))
  }

  private async monitorTargets(displays: Display[]): Promise<Map<string, MonitorTarget>> {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    const targets = new Map<string, MonitorTarget>()
    for (const [index, display] of displays.entries()) {
      const source = sources.find(candidate => candidate.display_id === String(display.id)) ?? (sources.length === displays.length ? sources[index] : undefined)
      if (source) targets.set(String(display.id), { captureId: source.id, label: display.label || source.name || `Display ${index + 1}`, display })
    }
    return targets
  }

  private refreshWindowTargets(session: PickerSession): Promise<void> {
    if (session.refreshing) return session.refreshing
    session.refreshing = (async () => {
      const targets = await this.windowTargets()
      if (session.completed || this.session !== session) return
      session.targets = windowsInSnapshotOrder(targets, session.targetOrder)
      if (session.activeTargetId && !session.targets.some(target => target.id === session.activeTargetId)) {
        session.activeTargetId = null
        this.broadcast(session, { kind: 'target', target: null })
      }
    })().finally(() => { session.refreshing = null })
    return session.refreshing
  }

  private async windowTargets(): Promise<WindowTarget[]> {
    const [nativeWindows, captureSources] = await Promise.all([
      openNativeWindows(),
      desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }),
    ])
    const native: NativeWindowMetadata[] = nativeWindows.map(window => ({
      ...window,
      bounds: this.toDipBounds(window.bounds),
    }))
    return matchWindowTargets(native, captureSources.map(source => ({ id: source.id, name: source.name })), process.pid, process.platform)
  }

  private toDipBounds(bounds: Rect): Rect {
    const rounded = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
    if (process.platform === 'win32') return screen.screenToDipRect(null, rounded)
    else if (process.platform === 'linux') {
      const start = screen.screenToDipPoint({ x: rounded.x, y: rounded.y })
      const end = screen.screenToDipPoint({ x: rounded.x + rounded.width, y: rounded.y + rounded.height })
      return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }
    } else if (process.platform === 'darwin') return rounded
    else throw new Error(`Unsupported picker platform: ${JSON.stringify(process.platform)}`)
  }

  private finish(session: PickerSession | null, selection: SourceSelection | null): void {
    if (!session || session.completed) return
    session.completed = true
    session.resolve(selection)
  }

  private cleanupSession(session: PickerSession): void {
    if (session.refreshTimer) clearInterval(session.refreshTimer)
    session.refreshTimer = null
    for (const { window } of session.overlays.values()) if (!window.isDestroyed()) window.destroy()
    session.overlays.clear()
    if (this.session === session) this.session = null
  }

  private broadcast(session: PickerSession, state: PickerOverlayState): void {
    for (const { window } of session.overlays.values()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('picker:state', state)
  }

  private sendError(session: PickerSession, message: string): void {
    if (!session.completed) this.broadcast(session, { kind: 'error', message })
  }
}

function validPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Partial<Point>
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: Number(point.x), y: Number(point.y) } : null
}

function globalPoint(display: Display, point: Point): Point {
  return { x: display.bounds.x + point.x, y: display.bounds.y + point.y }
}

function validatedPickerMode(mode: PickerMode): PickerMode {
  if (mode === 'rectangle') return mode
  else if (mode === 'window') return mode
  else throw new Error(`Unknown picker mode: ${JSON.stringify(mode)}`)
}
