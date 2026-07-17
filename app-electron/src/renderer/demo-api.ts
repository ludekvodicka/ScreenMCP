import { HIGHLIGHT_MAX_PER_SOURCE } from '../shared/contracts'
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
  InteractiveWriteAction,
  MaskRect,
  PickerMode,
  PreviewFrame,
  ScreenMcpApi,
  SourceSelection,
  UpdatePrompt,
  UpdateStatus,
} from '../shared/contracts'

function art(label: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#132945"/><stop offset="1" stop-color="#07111e"/></linearGradient></defs><rect width="960" height="600" fill="url(#g)"/><rect x="34" y="30" width="892" height="52" rx="12" fill="#0a1625" stroke="#29415a"/><circle cx="68" cy="56" r="8" fill="${accent}"/><text x="92" y="64" fill="#dce9f8" font-family="Arial" font-size="24">${label}</text><rect x="34" y="106" width="240" height="460" rx="14" fill="#0a1625"/><rect x="298" y="106" width="628" height="460" rx="14" fill="#0d1b2e"/><path d="M340 164h360M340 206h500M340 248h410M340 326h520M340 368h350" stroke="#36516d" stroke-width="15" stroke-linecap="round"/><rect x="340" y="438" width="220" height="70" rx="12" fill="${accent}" opacity=".7"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const sources: CaptureSource[] = [
  { id: 'screen:demo:0', kind: 'monitor', label: 'Monitor 1 · 2560×1440', thumbnailDataUrl: art('Monitor 1', '#62dbff'), appIconDataUrl: null, displayId: 'demo', width: 2560, height: 1440, warning: null },
  { id: 'screen:demo:1', kind: 'monitor', label: 'Monitor 2 · 1920×1080', thumbnailDataUrl: art('Monitor 2', '#8b7dff'), appIconDataUrl: null, displayId: 'demo-2', width: 1920, height: 1080, warning: null },
  { id: 'screen:demo:2', kind: 'monitor', label: 'Monitor 3 · 1920×1200', thumbnailDataUrl: art('Monitor 3', '#54d5a4'), appIconDataUrl: null, displayId: 'demo-3', width: 1920, height: 1200, warning: null },
  { id: 'window:editor:0', kind: 'window', label: 'Visual Studio Code · screenmcp', thumbnailDataUrl: art('Visual Studio Code', '#8b7dff'), appIconDataUrl: null, displayId: '', width: null, height: null, warning: null },
  { id: 'window:browser:0', kind: 'window', label: 'Documentation · Chromium', thumbnailDataUrl: art('Documentation', '#54d5a4'), appIconDataUrl: null, displayId: '', width: null, height: null, warning: null },
  { id: 'window:minimized:0', kind: 'window', label: 'Minimized application', thumbnailDataUrl: '', appIconDataUrl: null, displayId: '', width: null, height: null, warning: 'Preview unavailable; the window may be minimized or protected.' },
]

const settings: AppSettings = {
  closeAction: 'tray',
  accessModeDefault: 'read-only',
  followActiveDialogs: true,
  trayNoticeShown: false,
  hashThreshold: 4,
  jpegQuality: 80,
  maxLongSide: 1568,
  format: 'jpeg',
  auditThumbnailRetention: 100,
  sourcePolicies: {},
  masks: {},
  highlights: {},
  updates: { autoCheck: true, checkIntervalMinutes: 120 },
  shortcuts: { pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' },
}

export function createDemoApi(options: { interactiveRequest?: InteractiveWriteAction } = {}): ScreenMcpApi {
  const demoWindow = sources.find(source => source.id === 'window:editor:0')!
  let selection: SourceSelection | null = options.interactiveRequest
    ? { captureId: demoWindow.id, kind: demoWindow.kind, label: demoWindow.label, width: 2560, height: 1440 }
    : null
  let masks: MaskRect[] = [{ id: 'demo-redaction', x: 610, y: 390, width: 260, height: 95 }]
  const highlights: Record<string, HighlightRect[]> = {}
  const sourceListeners = new Set<(selection: SourceSelection | null) => void>()
  const stoppedListeners = new Set<(stopped: boolean) => void>()
  const controlListeners = new Set<(state: ControlState) => void>()
  const interactiveRequestListeners = new Set<(requests: InteractiveRequest[]) => void>()
  const auditListeners = new Set<(entry: AuditEntry) => void>()
  const updateListeners = new Set<(status: UpdateStatus) => void>()
  const updatePromptListeners = new Set<(prompt: UpdatePrompt) => void>()
  const updateOpenListeners = new Set<() => void>()
  const auditEntries: AuditEntry[] = [
    { id: 'demo-look', timestamp: Date.now() - 42_000, client: 'codex', action: 'look', source: 'Visual Studio Code · screenmcp', sourceKind: 'window', changed: true, hash: '0123456789abcdef', bytes: 48_210, thumbnail: 'demo-look.jpg', error: null },
    { id: 'demo-unchanged', timestamp: Date.now() - 18_000, client: 'claude', action: 'wait_for_change', source: 'Monitor 1 · 2560×1440', sourceKind: 'monitor', changed: false, hash: 'fedcba9876543210', bytes: null, thumbnail: null, error: null },
  ]
  let updateStatus: UpdateStatus = { channel: 'none', reason: 'Demo run — install a packaged release to use automatic updates.', autoCheck: true, checkIntervalMinutes: 120, running: '0.1.0', phase: 'idle', progress: null, lastError: null, lastCheckAt: null, lastCheckOutcome: null, pendingVersion: null, snoozedUntil: 0 }
  let controlState: ControlState = { armed: false, sourceKey: null }
  let interactiveRequests: InteractiveRequest[] = options.interactiveRequest
    ? [{ id: 'demo-interactive-request', client: 'codex', action: options.interactiveRequest, source: demoWindow.label }]
    : []
  const bootstrap: BootstrapState = {
    endpoint: { url: 'http://127.0.0.1:47210/mcp', token: 'demo', port: 47210 },
    captureState: { kind: 'connected', clients: ['codex'] },
    stopped: false,
    settings,
    platform: 'win32',
    wayland: false,
    selection,
    macScreenPermission: 'not-applicable',
    updateStatus,
    controlState,
    interactiveRequests,
  }
  const choose = (input: Omit<SourceSelection, 'width' | 'height'>): Promise<SourceSelection> => {
    let width: number
    let height: number
    if (input.kind === 'region') { width = input.region!.width; height = input.region!.height }
    else if (input.kind === 'monitor' || input.kind === 'window') {
      const source = sources.find(candidate => candidate.id === input.captureId)
      width = source?.width ?? 2560
      height = source?.height ?? 1440
    } else throw new Error(`Unknown source kind: ${JSON.stringify(input.kind)}`)
    selection = { ...structuredClone(input), width, height }
    highlights[selection.captureId] ??= [{ id: 'demo-highlight', shape: 'rect', label: 'Primary action', x: 300, y: 420, width: 250, height: 105 }]
    if (controlState.armed) {
      controlState = { ...controlState, armed: false, sourceKey: null }
      for (const listener of controlListeners) listener(structuredClone(controlState))
    }
    for (const listener of sourceListeners) listener(structuredClone(selection))
    return Promise.resolve(structuredClone(selection))
  }
  return {
    getBootstrapState: () => Promise.resolve(structuredClone({ ...bootstrap, selection, updateStatus, controlState, interactiveRequests })),
    listSources: () => Promise.resolve(structuredClone(sources.filter(source => source.kind === 'monitor'))),
    selectSource: choose,
    selectPortalSource: () => Promise.reject(new Error('Wayland portal is not active in demo mode')),
    pickSource: (mode: PickerMode) => {
      if (mode === 'rectangle') return choose({ captureId: sources[0]!.id, kind: 'region', label: `${sources[0]!.label} · region`, region: { x: 320, y: 180, width: 1280, height: 720 } })
      else if (mode === 'window') {
        const source = sources.find(candidate => candidate.kind === 'window')!
        return choose({ captureId: source.id, kind: source.kind, label: source.label })
      }
      else throw new Error(`Unknown picker mode: ${JSON.stringify(mode)}`)
    },
    clearSource: () => {
      selection = null
      if (controlState.armed) {
        controlState = { ...controlState, armed: false, sourceKey: null }
        for (const listener of controlListeners) listener(structuredClone(controlState))
      }
      for (const listener of sourceListeners) listener(null)
      return Promise.resolve()
    },
    getPreview: (): Promise<PreviewFrame | null> => bootstrap.stopped
      ? Promise.reject(new Error('ScreenMCP access mode is Off'))
      : Promise.resolve(selection ? { dataUrl: art(selection.label, '#62dbff'), format: 'jpeg', width: 960, height: 540, sourceWidth: selection.width, sourceHeight: selection.height, capturedAt: Date.now(), frameAgeMs: 16 } : null),
    updateSettings: patch => Promise.resolve(Object.assign(settings, patch)),
    setFramePolicy: (policy: FramePolicy) => { Object.assign(settings, policy); return Promise.resolve(settings) },
    getMasks: () => Promise.resolve(structuredClone(masks)),
    setMasks: next => { masks = structuredClone(next); return Promise.resolve(structuredClone(masks)) },
    getHighlights: () => Promise.resolve(structuredClone(selection ? highlights[selection.captureId] ?? [] : [])),
    setHighlights: next => {
      if (!selection) return Promise.reject(new Error('Select a source before changing highlights'))
      const stored = structuredClone(next.slice(0, HIGHLIGHT_MAX_PER_SOURCE))
      highlights[selection.captureId] = stored
      return Promise.resolve(structuredClone(stored))
    },
    requestScreenPermission: () => Promise.resolve('not-applicable'),
    openScreenPermissionSettings: () => Promise.resolve(),
    relaunch: () => Promise.resolve(),
    listAudit: (limit = 200) => Promise.resolve(structuredClone(auditEntries.slice(0, limit))),
    getAuditThumbnail: entryId => Promise.resolve(entryId === 'demo-look' ? art('Audit · redacted model frame', '#62dbff') : null),
    setStopped: stopped => {
      bootstrap.stopped = stopped
      if (stopped && controlState.armed) {
        controlState = { ...controlState, armed: false, sourceKey: null }
        for (const listener of controlListeners) listener(structuredClone(controlState))
      }
      for (const listener of stoppedListeners) listener(stopped)
      return Promise.resolve()
    },
    getControlState: () => Promise.resolve(structuredClone(controlState)),
    setAccessMode: (mode: AccessMode) => {
      if (mode === 'off') {
        bootstrap.stopped = true
        if (controlState.armed) {
          controlState = { armed: false, sourceKey: null }
          for (const listener of controlListeners) listener(structuredClone(controlState))
        }
      } else if (mode === 'read-only') {
        bootstrap.stopped = false
        if (controlState.armed) {
          controlState = { armed: false, sourceKey: null }
          for (const listener of controlListeners) listener(structuredClone(controlState))
        }
      } else if (mode === 'interactive') {
        if (!selection) return Promise.reject(new Error('Select a source before enabling Interactive'))
        bootstrap.stopped = false
        controlState = { armed: true, sourceKey: selection.captureId }
        for (const listener of controlListeners) listener(structuredClone(controlState))
      } else
        return Promise.reject(new Error(`Unknown access mode: ${JSON.stringify(mode)}`))
      for (const listener of stoppedListeners) listener(bootstrap.stopped)
      return Promise.resolve()
    },
    respondInteractiveRequest: (id: string, decision: InteractiveRequestDecision) => {
      if (!interactiveRequests.some(request => request.id === id)) return Promise.reject(new Error('Interactive request has expired'))
      if (decision === 'keep-read-only') interactiveRequests = []
      else if (decision === 'enable-interactive') {
        if (!selection) return Promise.reject(new Error('Select a source before enabling Interactive'))
        bootstrap.stopped = false
        controlState = { armed: true, sourceKey: selection.captureId }
        interactiveRequests = []
        for (const listener of controlListeners) listener(structuredClone(controlState))
      } else
        return Promise.reject(new Error(`Unknown interactive request decision: ${JSON.stringify(decision)}`))
      for (const listener of interactiveRequestListeners) listener(structuredClone(interactiveRequests))
      return Promise.resolve()
    },
    getShortcutStatus: () => Promise.resolve({ pickRegion: settings.shortcuts.pickRegion ? 'active' as const : 'off' as const, pickWindow: settings.shortcuts.pickWindow ? 'active' as const : 'off' as const }),
    getUpdateStatus: () => Promise.resolve(structuredClone(updateStatus)),
    checkForUpdates: () => {
      updateStatus = { ...updateStatus, lastCheckAt: Date.now(), lastCheckOutcome: updateStatus.reason }
      for (const listener of updateListeners) listener(structuredClone(updateStatus))
      return Promise.resolve(structuredClone(updateStatus))
    },
    downloadUpdate: () => Promise.reject(new Error(updateStatus.reason)),
    installUpdate: () => Promise.reject(new Error(updateStatus.reason)),
    snoozeUpdate: hours => {
      updateStatus = { ...updateStatus, snoozedUntil: Date.now() + hours * 60 * 60_000 }
      for (const listener of updateListeners) listener(structuredClone(updateStatus))
      return Promise.resolve(structuredClone(updateStatus))
    },
    openReleasePage: () => Promise.resolve(),
    onCaptureState: (_callback: (state: CaptureState) => void) => () => undefined,
    onStopped: callback => { stoppedListeners.add(callback); return () => stoppedListeners.delete(callback) },
    onControlState: callback => { controlListeners.add(callback); return () => controlListeners.delete(callback) },
    onInteractiveRequests: callback => { interactiveRequestListeners.add(callback); return () => interactiveRequestListeners.delete(callback) },
    onSourceChanged: callback => { sourceListeners.add(callback); return () => sourceListeners.delete(callback) },
    onAuditEntry: callback => { auditListeners.add(callback); return () => auditListeners.delete(callback) },
    onUpdateStatus: callback => { updateListeners.add(callback); return () => updateListeners.delete(callback) },
    onUpdatePrompt: callback => { updatePromptListeners.add(callback); return () => updatePromptListeners.delete(callback) },
    onUpdateOpen: callback => { updateOpenListeners.add(callback); return () => updateOpenListeners.delete(callback) },
  }
}
