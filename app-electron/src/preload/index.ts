import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccessMode,
  AppSettings,
  AuditEntry,
  BootstrapState,
  CaptureSource,
  CaptureState,
  ControlState,
  FramePolicy,
  HighlightRect,
  InteractiveRequest,
  InteractiveRequestDecision,
  MaskRect,
  MacScreenPermission,
  PickerMode,
  PreviewFrame,
  ScreenMcpApi,
  ShortcutStatus,
  SourceSelection,
  UpdatePrompt,
  UpdateStatus,
} from '../shared/contracts'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ScreenMcpApi = {
  getBootstrapState: () => ipcRenderer.invoke('app:bootstrap') as Promise<BootstrapState>,
  listSources: () => ipcRenderer.invoke('capture:list-sources') as Promise<CaptureSource[]>,
  selectSource: selection => ipcRenderer.invoke('capture:select-source', selection) as Promise<SourceSelection>,
  selectPortalSource: () => ipcRenderer.invoke('capture:select-portal') as Promise<SourceSelection>,
  pickSource: (mode: PickerMode) => ipcRenderer.invoke('capture:pick-source', mode) as Promise<SourceSelection | null>,
  clearSource: () => ipcRenderer.invoke('capture:clear-source') as Promise<void>,
  getPreview: () => ipcRenderer.invoke('capture:get-preview') as Promise<PreviewFrame | null>,
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch) as Promise<AppSettings>,
  setFramePolicy: (policy: FramePolicy) => ipcRenderer.invoke('settings:set-frame-policy', policy) as Promise<AppSettings>,
  getMasks: () => ipcRenderer.invoke('masks:get') as Promise<MaskRect[]>,
  setMasks: masks => ipcRenderer.invoke('masks:set', masks) as Promise<MaskRect[]>,
  getHighlights: () => ipcRenderer.invoke('highlights:get') as Promise<HighlightRect[]>,
  setHighlights: highlights => ipcRenderer.invoke('highlights:set', highlights) as Promise<HighlightRect[]>,
  requestScreenPermission: () => ipcRenderer.invoke('permissions:request-screen') as Promise<MacScreenPermission>,
  openScreenPermissionSettings: () => ipcRenderer.invoke('permissions:open-screen-settings') as Promise<void>,
  relaunch: () => ipcRenderer.invoke('app:relaunch') as Promise<void>,
  listAudit: limit => ipcRenderer.invoke('audit:list', limit) as Promise<AuditEntry[]>,
  getAuditThumbnail: entryId => ipcRenderer.invoke('audit:thumbnail', entryId) as Promise<string | null>,
  setStopped: stopped => ipcRenderer.invoke('capture:set-stopped', stopped) as Promise<void>,
  getControlState: () => ipcRenderer.invoke('control:get-state') as Promise<ControlState>,
  setAccessMode: (mode: AccessMode) => ipcRenderer.invoke('access:set-mode', mode) as Promise<void>,
  respondInteractiveRequest: (id: string, decision: InteractiveRequestDecision) => ipcRenderer.invoke('interactive:respond', id, decision) as Promise<void>,
  getShortcutStatus: () => ipcRenderer.invoke('shortcuts:status') as Promise<ShortcutStatus>,
  getUpdateStatus: () => ipcRenderer.invoke('updates:status') as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke('updates:check') as Promise<UpdateStatus>,
  downloadUpdate: () => ipcRenderer.invoke('updates:download') as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke('updates:install') as Promise<void>,
  snoozeUpdate: hours => ipcRenderer.invoke('updates:snooze', hours) as Promise<UpdateStatus>,
  openReleasePage: () => ipcRenderer.invoke('updates:open-release') as Promise<void>,
  onCaptureState: callback => subscribe<CaptureState>('capture:state', callback),
  onStopped: callback => subscribe<boolean>('capture:stopped', callback),
  onControlState: callback => subscribe<ControlState>('control:state', callback),
  onInteractiveRequests: callback => subscribe<InteractiveRequest[]>('interactive:requests', callback),
  onSourceChanged: callback => subscribe<SourceSelection | null>('source:changed', callback),
  onAuditEntry: callback => subscribe<AuditEntry>('audit:entry', callback),
  onUpdateStatus: callback => subscribe<UpdateStatus>('update:changed', callback),
  onUpdatePrompt: callback => subscribe<UpdatePrompt>('update:prompt', callback),
  onUpdateOpen: callback => subscribe<undefined>('update:open', callback),
}

contextBridge.exposeInMainWorld('screenmcp', api)
