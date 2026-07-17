import { app, Notification, screen } from 'electron'
import { join } from 'node:path'
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
import { publish } from './streams'
import { ScreenMcpTray } from './tray'
import { ElectronUpdaterAdapter } from './update/electron-updater-adapter'
import { UpdateManager } from './update/update-manager'
import { resolveUpdateRuntime } from './update/update-runtime'
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
let updates: UpdateManager | null = null
let controlService: ElectronControlService | null = null
let interactiveRequests: InteractiveRequestService | null = null
let shortcuts: GlobalShortcuts | null = null
let updateUnsubscribers: (() => void)[] = []

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
    const updateResolution = resolveUpdateRuntime({
      packaged: app.isPackaged,
      platform: process.platform,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
      settings: settings.get().updates,
    })
    updates = new UpdateManager(
      updateResolution,
      app.getVersion(),
      updateResolution.channel === 'github' ? new ElectronUpdaterAdapter() : null,
      updateLogPath(),
    )
    let notifiedVersion: string | null = null
    updateUnsubscribers = [
      updates.subscribe(status => publish('update:changed', status)),
      updates.onPrompt(prompt => {
        publish('update:prompt', prompt)
        if (prompt.trigger !== 'background' || notifiedVersion === prompt.version || !Notification.isSupported()) return
        notifiedVersion = prompt.version
        const notification = new Notification({ title: `ScreenMCP ${prompt.version} is available`, body: 'Open ScreenMCP to download the update.' })
        notification.on('click', () => { showMainWindow(); publish('update:open') })
        notification.show()
      }),
    ]
    updates.start()
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
    registerIpc(appState, settings, host, capture, captureService, controlService, accessMode, sourcePicker, audit, permissions, updates, shortcuts, interactiveRequests)
    const smokeOutput = process.env.SCREENMCP_CAPTURE_SMOKE
    if (smokeOutput) {
      await runCaptureSmoke(capture, captureService, smokeOutput)
      // Force a clean exit code: the graceful app.quit() teardown emits DBus/GObject
      // failures under headless Xvfb (no session bus) that can flip the process exit to 1.
      app.exit(0)
      return
    }
    shortcuts.apply(settings.get().shortcuts)
    tray = new ScreenMcpTray(appState, endpoint.port, updates, controlService)
    createAppWindow()
    host.setMcpHandler(mcpRouter.handle)
  }).catch(error => {
    console.error('ScreenMCP startup failed', error)
    app.quit()
  })
}

async function shutdown(): Promise<void> {
  for (const unsubscribe of updateUnsubscribers.splice(0)) unsubscribe()
  updates?.stop()
  updates = null
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
  const currentUpdates = updates
  const currentControl = controlService
  const currentInteractiveRequests = interactiveRequests
  host = null
  captureStream = null
  mcpRouter = null
  sourcePicker = null
  updates = null
  controlService = null
  interactiveRequests = null
  for (const unsubscribe of updateUnsubscribers.splice(0)) unsubscribe()
  shortcuts?.dispose()
  shortcuts = null
  currentUpdates?.stop()
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
