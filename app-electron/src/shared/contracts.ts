export type CaptureState =
  | { kind: 'disconnected' }
  | { kind: 'connected'; clients: string[] }
  | { kind: 'capturing'; clients: string[] }

export type SourceKind = 'monitor' | 'window' | 'region'
export type PickerMode = 'rectangle' | 'window'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskRect extends Rect {
  id: string
}

export type HighlightShape = 'rect'
export const HIGHLIGHT_MAX_PER_SOURCE = 12

export interface HighlightRect extends Rect {
  id: string
  shape: HighlightShape
  label?: string
}

export interface CaptureSource {
  id: string
  kind: 'monitor' | 'window'
  label: string
  thumbnailDataUrl: string
  appIconDataUrl: string | null
  displayId: string
  width: number | null
  height: number | null
  warning: string | null
}

export interface SourceSelection {
  captureId: string
  kind: SourceKind
  label: string
  region?: Rect
  width: number
  height: number
  captureWidth?: number
  captureHeight?: number
  // native display id for monitor/region sources; capture ids may be index-based and unstable
  displayId?: string
  followedFrom?: { captureId: string; label: string }
}

export interface PreviewFrame {
  dataUrl: string
  format: 'jpeg' | 'png'
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  capturedAt: number
  frameAgeMs: number
}

export type PickerOverlayState =
  | { kind: 'config'; mode: PickerMode; displayId: string; displayBounds: Rect }
  | { kind: 'target'; target: { id: string; label: string; bounds: Rect } | null }
  | { kind: 'error'; message: string }

export interface PickerOverlayApi {
  pointer(point: { x: number; y: number }): void
  selectWindow(point: { x: number; y: number }): void
  selectRectangle(start: { x: number; y: number }, end: { x: number; y: number }): void
  cancel(): void
  onState(callback: (state: PickerOverlayState) => void): () => void
}

export interface RawCaptureFrame {
  rgba: Uint8Array
  width: number
  height: number
  capturedAt: number
  frameAgeMs: number
}

export interface AuditEntry {
  id: string
  timestamp: number
  client: string
  action: 'look' | 'wait_for_change' | 'resource' | 'enumerate' | 'read' | 'click' | 'type'
  source: string | null
  sourceKind: SourceKind | null
  changed: boolean | null
  hash: string | null
  bytes: number | null
  thumbnail: string | null
  error: string | null
  target?: string | null
  method?: 'uia' | 'coord' | 'ocr' | null
  outcome?: string | null
}

export interface ControlState {
  armed: boolean
  sourceKey: string | null
}

export type AccessMode = 'off' | 'read-only' | 'interactive'
export type StartupAccessMode = 'off' | 'read-only'
export type InteractiveWriteAction = 'click' | 'type_text'
export type InteractiveRequestDecision = 'keep-read-only' | 'enable-interactive'

export interface InteractiveRequest {
  id: string
  client: string
  action: InteractiveWriteAction
  source: string
}

export interface EndpointInfo {
  url: string
  token: string
  port: number
}

export interface AppSettings {
  closeAction: 'tray' | 'quit'
  accessModeDefault: StartupAccessMode
  followActiveDialogs: boolean
  trayNoticeShown: boolean
  hashThreshold: number
  jpegQuality: number
  maxLongSide: number | null
  format: 'jpeg' | 'png'
  auditThumbnailRetention: number
  sourcePolicies: Record<string, FramePolicy>
  masks: Record<string, MaskRect[]>
  highlights: Record<string, HighlightRect[]>
  updates: UpdateSettings
  shortcuts: ShortcutSettings
}

export interface UpdateSettings {
  autoCheck: boolean
  checkIntervalMinutes: number
}

export type ShortcutAction = 'pickRegion' | 'pickWindow'
export type ShortcutSettings = Record<ShortcutAction, string | null>
export type ShortcutStatus = Record<ShortcutAction, 'active' | 'unavailable' | 'off'>

export type UpdateChannel = 'github' | 'none'
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

export interface UpdateDownloadProgress {
  version: string
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateStatus {
  channel: UpdateChannel
  reason: string
  autoCheck: boolean
  checkIntervalMinutes: number
  running: string
  phase: UpdatePhase
  progress: UpdateDownloadProgress | null
  lastError: string | null
  lastCheckAt: number | null
  lastCheckOutcome: string | null
  pendingVersion: string | null
  snoozedUntil: number
}

export interface UpdatePrompt {
  version: string
  running: string
  trigger: 'background' | 'manual'
}

export interface FramePolicy {
  format: 'jpeg' | 'png'
  jpegQuality: number
  maxLongSide: number | null
}

export type MacScreenPermission = 'not-applicable' | 'granted' | 'request-required' | 'denied' | 'restart-required'

export interface BootstrapState {
  endpoint: EndpointInfo | null
  captureState: CaptureState
  stopped: boolean
  settings: AppSettings
  platform: NodeJS.Platform
  wayland: boolean
  selection: SourceSelection | null
  macScreenPermission: MacScreenPermission
  updateStatus: UpdateStatus
  controlState: ControlState
  interactiveRequests: InteractiveRequest[]
}

export interface ScreenMcpApi {
  getBootstrapState(): Promise<BootstrapState>
  listSources(): Promise<CaptureSource[]>
  selectSource(selection: Omit<SourceSelection, 'width' | 'height'>): Promise<SourceSelection>
  selectPortalSource(): Promise<SourceSelection>
  pickSource(mode: PickerMode): Promise<SourceSelection | null>
  clearSource(): Promise<void>
  getPreview(): Promise<PreviewFrame | null>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  setFramePolicy(policy: FramePolicy): Promise<AppSettings>
  getMasks(): Promise<MaskRect[]>
  setMasks(masks: MaskRect[]): Promise<MaskRect[]>
  getHighlights(): Promise<HighlightRect[]>
  setHighlights(highlights: HighlightRect[]): Promise<HighlightRect[]>
  requestScreenPermission(): Promise<MacScreenPermission>
  openScreenPermissionSettings(): Promise<void>
  relaunch(): Promise<void>
  listAudit(limit?: number): Promise<AuditEntry[]>
  getAuditThumbnail(entryId: string): Promise<string | null>
  setStopped(stopped: boolean): Promise<void>
  getControlState(): Promise<ControlState>
  setAccessMode(mode: AccessMode): Promise<void>
  respondInteractiveRequest(id: string, decision: InteractiveRequestDecision): Promise<void>
  getShortcutStatus(): Promise<ShortcutStatus>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  snoozeUpdate(hours: number): Promise<UpdateStatus>
  openReleasePage(): Promise<void>
  onSourceChanged(callback: (selection: SourceSelection | null) => void): () => void
  onAuditEntry(callback: (entry: AuditEntry) => void): () => void
  onCaptureState(callback: (state: CaptureState) => void): () => void
  onStopped(callback: (stopped: boolean) => void): () => void
  onControlState(callback: (state: ControlState) => void): () => void
  onInteractiveRequests(callback: (requests: InteractiveRequest[]) => void): () => void
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  onUpdatePrompt(callback: (prompt: UpdatePrompt) => void): () => void
  onUpdateOpen(callback: () => void): () => void
}

export type CaptureWorkerRequest =
  | { kind: 'start'; requestId: string }
  | { kind: 'stop'; requestId: string }
  | { kind: 'grab'; requestId: string }

export type CaptureWorkerResult =
  | { kind: 'started'; width: number; height: number }
  | { kind: 'stopped' }
  | { kind: 'frame'; rgba: Uint8Array; width: number; height: number; capturedAt: number; frameAgeMs: number }

export interface CaptureWorkerResponse {
  requestId: string
  ok: boolean
  result?: CaptureWorkerResult
  error?: string
}

export interface CaptureWorkerApi {
  onRequest(callback: (request: CaptureWorkerRequest) => void): () => void
  respond(response: CaptureWorkerResponse): void
}
