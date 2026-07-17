import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceSelection } from '../shared/contracts'
import type { AccessModeController } from './access-mode'
import type { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController } from './capture-controller'
import type { ElectronCaptureService } from './capture-service'
import type { ElectronControlService } from './control-service'
import type { DesktopSourcePicker } from './desktop-source-picker'
import type { GlobalShortcuts } from './global-shortcuts'
import type { InteractiveRequestService } from './interactive-request-service'
import { registerIpc } from './ipc'
import type { McpHost } from './mcp-host'
import type { MacScreenPermissionService } from './permissions-macos'
import type { SettingsStore } from './settings-store'
import type { UpdateManager } from './update/update-manager'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))

vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler) } }))

beforeEach(() => ipc.handlers.clear())

describe('highlight IPC', () => {
  it('requires a selected source and forwards get/set to the settings store', async () => {
    let selection: SourceSelection | null = null
    const highlights = [{ id: 'one', shape: 'rect' as const, x: 1, y: 2, width: 3, height: 4 }]
    const getHighlights = vi.fn(() => highlights)
    const setHighlights = vi.fn(() => Promise.resolve(highlights))
    const settings = {
      highlights: getHighlights,
      setHighlights,
    } as unknown as SettingsStore
    const capture = { getSelection: () => selection } as unknown as CaptureController
    registerIpc(
      {} as AppState,
      settings,
      {} as McpHost,
      capture,
      {} as ElectronCaptureService,
      {} as ElectronControlService,
      {} as AccessModeController,
      {} as DesktopSourcePicker,
      {} as AuditLog,
      {} as MacScreenPermissionService,
      {} as UpdateManager,
      {} as GlobalShortcuts,
      {} as InteractiveRequestService,
    )
    const get = ipc.handlers.get('highlights:get')
    const set = ipc.handlers.get('highlights:set')
    if (!get || !set) throw new Error('Highlight IPC handlers were not registered')

    expect(() => get({})).toThrow('Select a source before reading highlights')
    expect(() => set({}, highlights)).toThrow('Select a source before changing highlights')

    selection = { captureId: 'screen:1', kind: 'monitor', label: 'Monitor', width: 100, height: 100 }
    expect(get({})).toEqual(highlights)
    await expect(set({}, highlights)).resolves.toEqual(highlights)
    expect(getHighlights).toHaveBeenCalledWith(selection)
    expect(setHighlights).toHaveBeenCalledWith(selection, highlights)
  })
})

describe('access mode IPC', () => {
  it('exposes one validated access transition path', () => {
    const control = { getState: vi.fn(() => ({ armed: false, sourceKey: null })), arm: vi.fn(), disarm: vi.fn() } as unknown as ElectronControlService
    const access = { setMode: vi.fn() } as unknown as AccessModeController
    registerIpc(
      {} as AppState,
      {} as SettingsStore,
      {} as McpHost,
      {} as CaptureController,
      {} as ElectronCaptureService,
      control,
      access,
      {} as DesktopSourcePicker,
      {} as AuditLog,
      {} as MacScreenPermissionService,
      {} as UpdateManager,
      {} as GlobalShortcuts,
      {} as InteractiveRequestService,
    )
    const setMode = ipc.handlers.get('access:set-mode')
    if (!setMode) throw new Error('Access mode IPC handler was not registered')
    expect(ipc.handlers.has('control:set-enabled')).toBe(false)
    expect(ipc.handlers.has('control:arm')).toBe(false)
    expect(ipc.handlers.has('control:disarm')).toBe(false)
    setMode({}, 'off')
    setMode({}, 'read-only')
    setMode({}, 'interactive')
    expect((access as unknown as { setMode: ReturnType<typeof vi.fn> }).setMode.mock.calls).toEqual([['off'], ['read-only'], ['interactive']])
    expect(() => setMode({}, 'future')).toThrow('Unknown access mode')
  })
})

describe('dialog following settings IPC', () => {
  it('persists the setting and asks the active source to refresh', async () => {
    const updated = { followActiveDialogs: false }
    const settings = { update: vi.fn(() => Promise.resolve(updated)) } as unknown as SettingsStore
    const refreshWindowDialog = vi.fn(() => Promise.resolve(null))
    const capture = { refreshWindowDialog } as unknown as CaptureController
    registerIpc(
      {} as AppState,
      settings,
      {} as McpHost,
      capture,
      {} as ElectronCaptureService,
      {} as ElectronControlService,
      {} as AccessModeController,
      {} as DesktopSourcePicker,
      {} as AuditLog,
      {} as MacScreenPermissionService,
      {} as UpdateManager,
      {} as GlobalShortcuts,
      {} as InteractiveRequestService,
    )
    const update = ipc.handlers.get('settings:update')
    if (!update) throw new Error('Settings IPC handler was not registered')

    await expect(update({}, { followActiveDialogs: false })).resolves.toEqual(updated)
    expect(refreshWindowDialog).toHaveBeenCalledOnce()
  })
})

describe('interactive request IPC', () => {
  it('validates the decision and enables Interactive before releasing the request', async () => {
    const log: string[] = []
    const access = { setMode: vi.fn((mode: string) => log.push(`mode:${mode}`)) } as unknown as AccessModeController
    const interactiveRequests = {
      respond: vi.fn((id: string, decision: string, enable: () => void) => {
        log.push(`respond:${id}:${decision}`)
        enable()
        log.push('released')
        return Promise.resolve()
      }),
    } as unknown as InteractiveRequestService
    const capture = { refreshWindowDialog: vi.fn(() => { log.push('refreshed'); return Promise.resolve(null) }) } as unknown as CaptureController
    registerIpc(
      {} as AppState,
      {} as SettingsStore,
      {} as McpHost,
      capture,
      {} as ElectronCaptureService,
      {} as ElectronControlService,
      access,
      {} as DesktopSourcePicker,
      {} as AuditLog,
      {} as MacScreenPermissionService,
      {} as UpdateManager,
      {} as GlobalShortcuts,
      interactiveRequests,
    )
    const respond = ipc.handlers.get('interactive:respond')
    if (!respond) throw new Error('Interactive request IPC handler was not registered')

    await expect(respond({}, 'request-1', 'enable-interactive')).resolves.toBeUndefined()
    expect(log).toEqual(['refreshed', 'respond:request-1:enable-interactive', 'mode:interactive', 'released'])
    await expect(Promise.resolve().then(() => respond({}, '', 'keep-read-only'))).rejects.toThrow('non-empty string')
    await expect(Promise.resolve().then(() => respond({}, 'request-1', 'future'))).rejects.toThrow('Unknown interactive request decision')
  })
})
