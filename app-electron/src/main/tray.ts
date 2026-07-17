import { Resvg } from '@resvg/resvg-js'
import { app, Menu, nativeImage, shell, Tray, type NativeImage } from 'electron'
import type { ControlState, UpdateStatus } from '../shared/contracts'
import type { AppState, AppStateSnapshot } from './app-state'
import { publish } from './streams'
import { trayColor, trayVisualState } from './tray-state'
import type { UpdateManager } from './update/update-manager'
import type { ElectronControlService } from './control-service'
import { getMainWindow, setQuitting, showMainWindow } from './window'

const iconCache = new Map<ReturnType<typeof trayVisualState>, NativeImage>()

export class ScreenMcpTray {
  private tray: Tray
  private snapshot: AppStateSnapshot
  private updateStatus: UpdateStatus
  private controlState: ControlState
  private lastLookAt: number | null = null
  private unsubscribeAppState: () => void
  private unsubscribeUpdates: () => void
  private unsubscribeControl: () => void

  constructor(private appState: AppState, private port: number, private updates: UpdateManager, private control: ElectronControlService) {
    this.snapshot = { stopped: appState.isStopped(), captureState: appState.getCaptureState() }
    this.updateStatus = updates.getStatus()
    this.controlState = control.getState()
    this.tray = new Tray(renderIcon(trayVisualState(this.snapshot, this.controlState)))
    this.unsubscribeAppState = appState.subscribe(snapshot => {
      if (isCapturing(snapshot)) this.lastLookAt = Date.now()
      this.snapshot = snapshot
      this.refresh()
    })
    this.unsubscribeUpdates = updates.subscribe(status => {
      this.updateStatus = status
      this.refresh()
    })
    this.unsubscribeControl = control.subscribe(state => {
      this.controlState = state
      this.refresh()
    })
    this.tray.on('double-click', showMainWindow)
    this.refresh()
  }

  dispose(): void {
    this.unsubscribeAppState()
    this.unsubscribeUpdates()
    this.unsubscribeControl()
    this.tray.destroy()
  }

  private refresh(): void {
    const visual = trayVisualState(this.snapshot, this.controlState)
    this.tray.setImage(renderIcon(visual))
    this.tray.setToolTip(this.tooltip())
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Hide ScreenMCP', click: () => { const window = getMainWindow(); if (window?.isVisible()) window.hide(); else showMainWindow() } },
      { type: 'separator' },
      { label: 'STOP serving', type: 'checkbox', checked: this.snapshot.stopped, click: item => this.appState.setStopped(item.checked) },
      ...(this.controlState.armed ? [{ label: 'Turn off interaction', click: () => this.control.disarm('manual') } as const] : []),
      { type: 'separator' },
      { label: updateMenuLabel(this.updateStatus), enabled: this.updateStatus.phase !== 'checking' && this.updateStatus.phase !== 'downloading' && this.updateStatus.phase !== 'installing', click: () => void this.openUpdates() },
      { type: 'separator' },
      { label: 'Quit', click: () => { setQuitting(true); app.quit() } },
    ]))
  }

  private async openUpdates(): Promise<void> {
    if (this.updateStatus.channel === 'none') {
      await shell.openExternal('https://github.com/ludekvodicka/ScreenMCP/releases/latest')
      return
    } else if (this.updateStatus.channel !== 'github')
      throw new Error(`Unknown update channel: ${JSON.stringify(this.updateStatus.channel)}`)
    showMainWindow()
    publish('update:open')
    if (this.updateStatus.phase === 'idle' || this.updateStatus.phase === 'error') await this.updates.check('manual')
  }

  private tooltip(): string {
    const state = this.snapshot.captureState
    const clients = state.kind === 'disconnected' ? 'no clients' : state.clients.join(', ') || 'unnamed client'
    const status = this.snapshot.stopped ? 'ACCESS OFF' : this.controlState.armed ? 'INTERACTION ALLOWED' : state.kind === 'capturing' ? 'capturing' : state.kind === 'connected' ? 'connected' : state.kind === 'disconnected' ? 'disconnected' : unknownState(state)
    const lastLook = this.lastLookAt ? ` · last look ${new Date(this.lastLookAt).toLocaleTimeString()}` : ''
    return `ScreenMCP · ${status} · ${clients} · :${this.port}${lastLook}`
  }
}

function updateMenuLabel(status: UpdateStatus): string {
  if (status.channel === 'none') return 'Download updates manually…'
  else if (status.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(status.channel)}`)
  if (status.phase === 'idle') return 'Check for updates…'
  else if (status.phase === 'checking') return 'Checking for updates…'
  else if (status.phase === 'available') return `Update ${status.pendingVersion ?? ''} available…`
  else if (status.phase === 'downloading') return `Downloading ${status.pendingVersion ?? ''} · ${Math.round(status.progress?.percent ?? 0)}%`
  else if (status.phase === 'ready') return `Restart to install ${status.pendingVersion ?? ''}…`
  else if (status.phase === 'installing') return `Installing ${status.pendingVersion ?? ''}…`
  else if (status.phase === 'error') return 'Update failed…'
  else throw new Error(`Unknown update phase: ${JSON.stringify(status.phase)}`)
}

function unknownState(value: never): never {
  throw new Error(`Unknown capture state: ${JSON.stringify(value)}`)
}

function isCapturing(snapshot: AppStateSnapshot): boolean {
  if (snapshot.captureState.kind === 'disconnected') return false
  else if (snapshot.captureState.kind === 'connected') return false
  else if (snapshot.captureState.kind === 'capturing') return true
  else throw new Error(`Unknown capture state: ${JSON.stringify(snapshot.captureState)}`)
}

function renderIcon(state: ReturnType<typeof trayVisualState>) {
  const cached = iconCache.get(state)
  if (cached) return cached
  const color = trayColor(state)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="4" width="26" height="19" rx="5" fill="#07111e" stroke="${color}" stroke-width="3"/><path d="M11 28h10M16 23v5" stroke="${color}" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="9" r="3.5" fill="${color}"/></svg>`
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: process.platform === 'darwin' ? 36 : 32 } }).render().asPng()
  const icon = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
  iconCache.set(state, icon)
  return icon
}
