import { ipcMain, shell } from 'electron'
import type { AccessMode, AppSettings, BootstrapState, FramePolicy, HighlightRect, InteractiveRequestDecision, MaskRect, PickerMode, SourceSelection } from '../shared/contracts'
import type { AccessModeController } from './access-mode'
import type { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController } from './capture-controller'
import type { ElectronCaptureService } from './capture-service'
import type { ElectronControlService } from './control-service'
import type { DesktopSourcePicker } from './desktop-source-picker'
import type { GlobalShortcuts } from './global-shortcuts'
import type { InteractiveRequestService } from './interactive-request-service'
import type { McpHost } from './mcp-host'
import type { MacScreenPermissionService } from './permissions-macos'
import type { SettingsStore } from './settings-store'
import type { UpdateManager } from './update/update-manager'

export function registerIpc(
  appState: AppState,
  settings: SettingsStore,
  host: McpHost,
  capture: CaptureController,
  captureService: ElectronCaptureService,
  control: ElectronControlService,
  access: AccessModeController,
  sourcePicker: DesktopSourcePicker,
  audit: AuditLog,
  permissions: MacScreenPermissionService,
  updates: UpdateManager,
  shortcuts: GlobalShortcuts,
  interactiveRequests: InteractiveRequestService,
): void {
  ipcMain.handle('app:bootstrap', (): BootstrapState => ({
    endpoint: host.getEndpoint(),
    captureState: appState.getCaptureState(),
    stopped: appState.isStopped(),
    settings: settings.get(),
    platform: process.platform,
    wayland: process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland'),
    selection: capture.getSelection(),
    macScreenPermission: permissions.state(),
    updateStatus: updates.getStatus(),
    controlState: control.getState(),
    interactiveRequests: interactiveRequests.listPending(),
  }))
  ipcMain.handle('capture:list-sources', () => permissions.canCapture() ? capture.listSources() : [])
  ipcMain.handle('capture:select-source', (_event, selection: Omit<SourceSelection, 'width' | 'height'>) => {
    if (!permissions.canCapture()) throw new Error('Screen Recording permission is not active')
    return capture.select(selection)
  })
  ipcMain.handle('capture:select-portal', () => capture.selectPortal())
  ipcMain.handle('capture:pick-source', (_event, value: unknown) => {
    if (!permissions.canCapture()) throw new Error('Screen Recording permission is not active')
    let mode: PickerMode
    if (value === 'rectangle') mode = value
    else if (value === 'window') mode = value
    else throw new TypeError(`Unknown picker mode: ${JSON.stringify(value)}`)
    return sourcePicker.pick(mode)
  })
  ipcMain.handle('capture:clear-source', () => capture.clear())
  ipcMain.handle('capture:get-preview', () => captureService.preview())
  ipcMain.handle('capture:set-stopped', (_event, stopped: unknown) => {
    if (typeof stopped !== 'boolean') throw new TypeError('stopped must be boolean')
    appState.setStopped(stopped)
  })
  ipcMain.handle('control:get-state', () => control.getState())
  ipcMain.handle('access:set-mode', (_event, value: unknown) => {
    let mode: AccessMode
    if (value === 'off') mode = value
    else if (value === 'read-only') mode = value
    else if (value === 'interactive') mode = value
    else throw new TypeError(`Unknown access mode: ${JSON.stringify(value)}`)
    access.setMode(mode)
  })
  ipcMain.handle('interactive:respond', async (_event, id: unknown, value: unknown) => {
    if (typeof id !== 'string' || !id) throw new TypeError('Interactive request ID must be a non-empty string')
    let decision: InteractiveRequestDecision
    if (value === 'keep-read-only') decision = value
    else if (value === 'enable-interactive') decision = value
    else throw new TypeError(`Unknown interactive request decision: ${JSON.stringify(value)}`)
    if (decision === 'enable-interactive') await capture.refreshWindowDialog()
    else if (decision !== 'keep-read-only') throw new Error(`Unknown interactive request decision: ${JSON.stringify(decision)}`)
    await interactiveRequests.respond(id, decision, () => access.setMode('interactive'))
  })
  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    const updated = await settings.update(patch)
    if (patch && typeof patch === 'object' && 'shortcuts' in patch) shortcuts.apply(updated.shortcuts)
    if (patch && typeof patch === 'object' && 'followActiveDialogs' in patch) void capture.refreshWindowDialog().catch(error => console.warn('Could not refresh active dialog setting', error))
    return updated
  })
  ipcMain.handle('shortcuts:status', () => shortcuts.status())
  ipcMain.handle('settings:set-frame-policy', (_event, policy: FramePolicy) => {
    const selection = capture.getSelection()
    if (!selection) throw new Error('Select a source before changing its frame policy')
    return settings.setFramePolicy(selection, policy)
  })
  ipcMain.handle('masks:get', () => {
    const selection = capture.getSelection()
    if (!selection) throw new Error('Select a source before reading redaction masks')
    return settings.masks(selection)
  })
  ipcMain.handle('masks:set', (_event, masks: MaskRect[]) => {
    const selection = capture.getSelection()
    if (!selection) throw new Error('Select a source before changing redaction masks')
    return settings.setMasks(selection, masks)
  })
  ipcMain.handle('highlights:get', () => {
    const selection = capture.getSelection()
    if (!selection) throw new Error('Select a source before reading highlights')
    return settings.highlights(selection)
  })
  ipcMain.handle('highlights:set', (_event, highlights: HighlightRect[]) => {
    const selection = capture.getSelection()
    if (!selection) throw new Error('Select a source before changing highlights')
    return settings.setHighlights(selection, highlights)
  })
  ipcMain.handle('permissions:request-screen', () => permissions.request())
  ipcMain.handle('permissions:open-screen-settings', () => permissions.openSettings())
  ipcMain.handle('app:relaunch', () => permissions.relaunch())
  ipcMain.handle('audit:list', (_event, limit?: number) => audit.list(limit))
  ipcMain.handle('audit:thumbnail', (_event, entryId: string) => audit.thumbnail(entryId))
  ipcMain.handle('updates:status', () => updates.getStatus())
  ipcMain.handle('updates:check', () => updates.check('manual'))
  ipcMain.handle('updates:download', () => updates.download())
  ipcMain.handle('updates:install', () => updates.install())
  ipcMain.handle('updates:snooze', (_event, hours: unknown) => {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) throw new TypeError('Update snooze hours must be a finite number')
    return updates.snooze(hours)
  })
  ipcMain.handle('updates:open-release', () => shell.openExternal('https://github.com/ludekvodicka/ScreenMCP/releases/latest'))
}
