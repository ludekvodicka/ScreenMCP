import type { MacScreenPermission, PickerMode, SourceSelection } from '../../shared/contracts'

interface Props {
  selection: SourceSelection | null
  busy: boolean
  wayland: boolean
  macScreenPermission: MacScreenPermission
  error: string | null
  onPick: (mode: PickerMode) => void
  onScreen: () => void
  onPortal: () => void
  onRequestPermission: () => void
  onOpenPermissionSettings: () => void
  onRelaunch: () => void
}

export function SourcePicker({ selection, busy, wayland, macScreenPermission, error, onPick, onScreen, onPortal, onRequestPermission, onOpenPermissionSettings, onRelaunch }: Props) {
  if (macScreenPermission === 'request-required') return <MacPermission title="Allow Screen Recording" body="macOS will ask which apps may capture your screen. ScreenMCP must relaunch after you grant access." action="Request access" onAction={onRequestPermission} busy={busy} error={error} />
  else if (macScreenPermission === 'denied') return <MacPermission title="Screen Recording is blocked" body="Enable ScreenMCP in Privacy & Security → Screen Recording, then relaunch the app." action="Open System Settings" onAction={onOpenPermissionSettings} secondary="Relaunch" onSecondary={onRelaunch} busy={busy} error={error} />
  else if (macScreenPermission === 'restart-required') return <MacPermission title="Relaunch required" body="macOS applies the Screen Recording grant only after ScreenMCP starts again." action="Relaunch ScreenMCP" onAction={onRelaunch} busy={busy} error={error} />
  assertPermissionReady(macScreenPermission)
  if (wayland) return (
    <section className="source-picker portal-picker">
      <div className="portal-art"><span>↗</span></div>
      <p className="eyebrow">WAYLAND PORTAL</p>
      <h2>Your system chooses what to share.</h2>
      <p>ScreenMCP keeps the selected stream open, so the system picker is not shown for every look.</p>
      <button className="primary-button" disabled={busy} onClick={onPortal}>{busy ? 'Opening picker…' : 'Share screen or window'}</button>
      {error && <p className="inline-error">{error}</p>}
    </section>
  )
  return (
    <section className="source-picker">
      <div className="section-heading">
        <div><p className="eyebrow">CAPTURE SOURCE</p><h2>Choose one source</h2></div>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="picker-tools">
        <button className={toolClass(selection, 'region')} disabled={busy} onClick={() => onPick('rectangle')}>
          <span className="picker-tool-icon"><RectangleIcon /></span>
          <span className="picker-tool-copy"><strong>Rectangle</strong><small>Drag anywhere on any display to capture a precise region.</small></span>
          <span className="picker-tool-arrow">↗</span>
        </button>
        <button className={toolClass(selection, 'window')} disabled={busy} onClick={() => onPick('window')}>
          <span className="picker-tool-icon"><WindowTargetIcon /></span>
          <span className="picker-tool-copy"><strong>Window</strong><small>Point at any desktop window to highlight and select it.</small></span>
          <span className="picker-tool-arrow">↗</span>
        </button>
        <button className={toolClass(selection, 'monitor')} disabled={busy} onClick={onScreen}>
          <span className="picker-tool-icon"><WholeScreenIcon /></span>
          <span className="picker-tool-copy"><strong>Whole screen</strong><small>Choose one complete display from a visual overview.</small></span>
          <span className="picker-tool-arrow">↗</span>
        </button>
      </div>
      <div className="current-source">
        <span className={selection ? 'source-indicator active' : 'source-indicator'} />
        <div>
          <small>{busy ? 'Picker open' : selection?.followedFrom ? 'following active dialog' : selection ? `${selection.kind} selected` : 'No source selected'}</small>
          <strong title={selection?.label}>{busy ? 'Complete the selection on your desktop' : selection?.label ?? 'The model cannot see your screen'}</strong>
        </div>
      </div>
    </section>
  )
}

function toolClass(selection: SourceSelection | null, kind: SourceSelection['kind']): string {
  return selection?.kind === kind ? 'picker-tool active' : 'picker-tool'
}

function RectangleIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 10V6h4M22 6h4v4M26 22v4h-4M10 26H6v-4"/><rect x="10" y="10" width="12" height="12" rx="2"/></svg>
}

function WindowTargetIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="8" width="18" height="16" rx="2"/><path d="M7 13h18M16 4v7M16 21v7M4 16h7M21 16h7"/><circle cx="16" cy="16" r="3"/></svg>
}

function WholeScreenIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="7" width="24" height="17" rx="2"/><path d="M12 28h8M16 24v4"/></svg>
}

function assertPermissionReady(permission: MacScreenPermission): void {
  if (permission === 'not-applicable') return
  else if (permission === 'granted') return
  else if (permission === 'request-required' || permission === 'denied' || permission === 'restart-required') throw new Error(`macOS permission screen was not handled: ${permission}`)
  else throw new Error(`Unknown macOS permission state: ${JSON.stringify(permission)}`)
}

function MacPermission({ title, body, action, secondary, busy, error, onAction, onSecondary }: { title: string; body: string; action: string; secondary?: string; busy: boolean; error: string | null; onAction: () => void; onSecondary?: () => void }) {
  return <section className="source-picker portal-picker"><div className="portal-art"><span>◉</span></div><p className="eyebrow">MACOS PRIVACY</p><h2>{title}</h2><p>{body}</p><div className="permission-actions"><button className="primary-button" disabled={busy} onClick={onAction}>{action}</button>{secondary && onSecondary && <button disabled={busy} onClick={onSecondary}>{secondary}</button>}</div>{error && <p className="inline-error">{error}</p>}</section>
}
