import { app, Notification, screen } from 'electron'
import { join } from 'node:path'
import type { DtoAutoUpdateStatus } from '../../../shared/electron/autoUpdate/common/autoUpdate.dto'
import type { AutoUpdateLogHandler } from '../../../shared/electron/autoUpdate/main/autoUpdate.types'
import { AutoUpdateMain } from '../../../shared/electron/autoUpdate/main/autoUpdateMain'
import { AppState } from './app-state'
import { AccessModeController, applyStartupAccessMode } from './access-mode'
import { AuditLog } from './audit-log'
import { CaptureController } from './capture-controller'
import { CaptureStream } from './capture-stream'
import { runCaptureSmoke } from './capture-smoke'
import { ElectronCaptureService } from './capture-service'
import { ElectronControlService } from './control-service'
import { CoordinateResolver } from './coordinate-resolver'
import { DesktopSourcePicker } from './desktop-source-picker'
import { GlobalShortcuts } from './global-shortcuts'
import { InteractiveRequestService } from './interactive-request-service'
import { inspectNativeWindowWin32 } from './native-window-enum'
import { smokeLog } from './smoke-log'
import { loadOrCreateToken } from './endpoint-store'
import { registerIpc } from './ipc'
import { McpHost } from './mcp-host'
import { McpClients } from './mcp-clients'
import { McpRouter } from './mcp-router'
import { MacScreenPermissionService } from './permissions-macos'
import { OcrReader } from './ocr'
import { SettingsStore } from './settings-store'
import { ScreenMcpTray } from './tray'
import { appendUpdateLog, type UpdateLogEntry } from './update/update-log-store'
import { configDir, updateLogPath } from './paths'
import { installBundledAgentSkills, type SkillInstallResult } from './skill-installer'
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './window'
import { UiaClient } from './uia-client'
import { WinInput } from './win-input'

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
// PipeWire is the Wayland screen-capture backend. Requesting it on X11 — including headless Xvfb,
// which has no PipeWire — makes getDisplayMedia hang, so enable it only when a Wayland session is present.
if (process.platform === 'linux' && (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland'))
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')

const settings = new SettingsStore()
const appState = new AppState()
let host: McpHost | null = null
let captureStream: CaptureStream | null = null
let mcpRouter: McpRouter | null = null
let mcpClients: McpClients | null = null
let tray: ScreenMcpTray | null = null
let sourcePicker: DesktopSourcePicker | null = null
let autoUpdate: AutoUpdateMain | null = null
let controlService: ElectronControlService | null = null
let interactiveRequests: InteractiveRequestService | null = null
let shortcuts: GlobalShortcuts | null = null
let unsubscribeAutoUpdate: (() => void) | null = null
let lastUpdateState: DtoAutoUpdateStatus['state']['kind'] | null = null
let readyNotifiedVersion: string | null = null

app.on('second-instance', showMainWindow)
app.on('before-quit', () => { setQuitting(true); controlService?.disarm('quit') })
app.on('activate', () => {
  if (getMainWindow()) showMainWindow()
  else createAppWindow()
})
app.on('window-all-closed', () => {})

if (singleInstance) {
  void app.whenReady().then(async () => {
    smokeLog('app ready')
    await settings.load()
    applyStartupAccessMode(appState, settings.get().accessModeDefault)
    smokeLog('settings loaded')
    await installAgentSkills()
    const updateSettings = settings.get().updates
    const updater = new AutoUpdateMain({
      releasePageUrl: version => version ? `https://github.com/ludekvodicka/ScreenMCP/releases/tag/v${version}` : 'https://github.com/ludekvodicka/ScreenMCP/releases',
      backgroundChecks: updateSettings.autoCheck,
      intervalMinutes: updateSettings.checkIntervalMinutes,
      log: updateLog,
    })
    autoUpdate = updater
    unsubscribeAutoUpdate = updater.subscribe(followUpdateStatus)
    updater.start()
    host = new McpHost(await loadOrCreateToken())
    const endpoint = await host.start()
    smokeLog('host started')
    captureStream = new CaptureStream()
    await captureStream.initialize()
    smokeLog('capture stream initialized')
    const capture = new CaptureController(captureStream, { followActiveDialogs: () => settings.get().followActiveDialogs })
    sourcePicker = new DesktopSourcePicker(capture)
    const audit = new AuditLog(() => settings.get().auditThumbnailRetention)
    const permissions = new MacScreenPermissionService()
    mcpClients = new McpClients(appState)
    const captureService = new ElectronCaptureService(capture, settings, appState, audit, mcpClients)
    const coordinates = new CoordinateResolver(
      selection => settings.framePolicy(selection).maxLongSide,
      {
        platform: process.platform,
        getAllDisplays: () => screen.getAllDisplays().map(display => ({ id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor })),
        dipToScreenPoint: point => screen.dipToScreenPoint(point),
        screenToDipPoint: point => screen.screenToDipPoint(point),
        windowById: id => {
          const window = inspectNativeWindowWin32(id)
          return Promise.resolve(window ? { id: window.id, bounds: { ...window.bounds } } : null)
        },
      },
    )
    interactiveRequests = new InteractiveRequestService(capture, appState)
    controlService = new ElectronControlService(capture, captureService, appState, audit, new UiaClient(), new WinInput(), new OcrReader(), coordinates, { interactiveRequests })
    const accessMode = new AccessModeController(appState, controlService)
    mcpRouter = new McpRouter(captureService, controlService, {
      onConnected: (sessionId, client) => mcpClients?.connected(sessionId, client),
      onActivity: (sessionId, client) => mcpClients?.activity(sessionId, client),
      onStreamOpened: (sessionId, client) => mcpClients?.streamOpened(sessionId, client),
      onStreamClosed: sessionId => mcpClients?.streamClosed(sessionId),
      onDisconnected: sessionId => mcpClients?.disconnected(sessionId),
    })
    const picker = sourcePicker
    shortcuts = new GlobalShortcuts(mode => picker.pick(mode), () => permissions.canCapture(), showMainWindow)
    registerIpc(appState, settings, host, capture, captureService, controlService, accessMode, sourcePicker, audit, permissions, shortcuts, interactiveRequests)
    const smokeOutput = process.env.SCREENMCP_CAPTURE_SMOKE
    if (smokeOutput) {
      await runCaptureSmoke(capture, captureService, smokeOutput)
      // Force a clean exit code: the graceful app.quit() teardown emits DBus/GObject
      // failures under headless Xvfb (no session bus) that can flip the process exit to 1.
      app.exit(0)
      return
    }
    shortcuts.apply(settings.get().shortcuts)
    tray = new ScreenMcpTray(appState, endpoint.port, updater, controlService)
    createAppWindow()
    host.setMcpHandler(mcpRouter.handle)
  }).catch(error => {
    console.error('ScreenMCP startup failed', error)
    // The graceful quit path stalls under headless Xvfb, so the smoke run would hang until its
    // harness kills it and the real error never reaches the report.
    if (process.env.SCREENMCP_CAPTURE_SMOKE) app.exit(1)
    else app.quit()
  })
}

async function shutdown(): Promise<void> {
  stopAutoUpdate()
  shortcuts?.dispose()
  shortcuts = null
  sourcePicker?.dispose()
  sourcePicker = null
  await interactiveRequests?.dispose()
  interactiveRequests = null
  await mcpRouter?.close()
  mcpClients?.dispose()
  tray?.dispose()
  tray = null
  await controlService?.dispose()
  controlService = null
  await captureStream?.dispose()
  await host?.stop()
}

app.on('will-quit', event => {
  if (!host && !captureStream && !mcpRouter) return
  event.preventDefault()
  const current = host
  const currentCapture = captureStream
  const currentRouter = mcpRouter
  const currentPicker = sourcePicker
  const currentControl = controlService
  const currentInteractiveRequests = interactiveRequests
  host = null
  captureStream = null
  mcpRouter = null
  sourcePicker = null
  controlService = null
  interactiveRequests = null
  stopAutoUpdate()
  shortcuts?.dispose()
  shortcuts = null
  currentPicker?.dispose()
  mcpClients?.dispose()
  mcpClients = null
  tray?.dispose()
  tray = null
  const disposeControl = async (): Promise<void> => {
    await currentInteractiveRequests?.dispose()
    await currentControl?.dispose()
  }
  void Promise.all([currentRouter?.close(), current?.stop(), currentCapture?.dispose(), disposeControl()]).finally(() => app.quit())
})

const updateLog: AutoUpdateLogHandler = {
  info: message => writeUpdateLog({ event: 'updater', level: 'info', message }),
  warn: message => writeUpdateLog({ event: 'updater', level: 'warn', message }),
  error: message => writeUpdateLog({ event: 'updater', level: 'error', message }),
}

function writeUpdateLog(entry: Omit<UpdateLogEntry, 'ts'>): void {
  try { appendUpdateLog(updateLogPath(), entry) }
  catch (error) { console.error('ScreenMCP update log failed', error) }
}

function followUpdateStatus(status: DtoAutoUpdateStatus): void {
  const state = status.state
  const previous = lastUpdateState
  lastUpdateState = state.kind
  if (state.kind !== previous) {
    const message = state.kind === 'off' ? state.reason : state.kind === 'failed' ? state.message : undefined
    const version = 'release' in state ? state.release?.version ?? null : null
    writeUpdateLog({ event: 'state', mode: status.mode, running: status.running, state: state.kind, version, ...(message ? { message } : {}) })
  }
  // Close-to-tray would hide the window instead of letting the installer quit the app.
  if (state.kind === 'installing') setQuitting(true)
  else if (previous === 'installing' && state.kind === 'failed') setQuitting(false)
  if (state.kind === 'ready' && readyNotifiedVersion !== state.release.version) {
    readyNotifiedVersion = state.release.version
    notifyUpdateReady(state.release.version)
  }
}

function notifyUpdateReady(version: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: `ScreenMCP ${version} is ready`, body: 'Choose Restart and install in ScreenMCP or its tray menu. It also installs on the next quit.' })
  notification.on('click', showMainWindow)
  notification.show()
}

function stopAutoUpdate(): void {
  unsubscribeAutoUpdate?.()
  unsubscribeAutoUpdate = null
  autoUpdate?.stop()
  autoUpdate = null
}

async function installAgentSkills(): Promise<void> {
  const bundleRoot = app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'skills')
  try {
    for (const result of await installBundledAgentSkills({ bundleRoot, stateRoot: configDir() })) reportSkillInstall(result)
  } catch (error) {
    console.warn('ScreenMCP skill installation failed', error)
  }
}

function reportSkillInstall(result: SkillInstallResult): void {
  if (result.status === 'not_detected') return
  else if (result.status === 'installed') console.info(`Installed ${result.agent} skill at ${result.linkPath}`)
  else if (result.status === 'updated') console.info(`Updated ${result.agent} skill at ${result.linkPath}`)
  else if (result.status === 'current') console.info(`${result.agent} skill is current at ${result.linkPath}`)
  else if (result.status === 'conflict') console.warn(`Skipped ${result.agent} skill at ${result.linkPath}: ${result.reason}`)
  else if (result.status === 'failed') console.warn(`Could not install ${result.agent} skill: ${result.reason}`)
  else
    throw new Error(`Unknown skill installation result: ${JSON.stringify(result)}`)
}

process.on('SIGTERM', () => void shutdown().finally(() => app.quit()))
process.on('SIGINT', () => void shutdown().finally(() => app.quit()))

function createAppWindow() {
  const window = createMainWindow(settings)
  return window
}
