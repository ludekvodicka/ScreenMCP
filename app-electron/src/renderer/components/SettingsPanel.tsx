import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AppSettings, FramePolicy, ShortcutAction, ShortcutStatus, SourceSelection, UpdateStatus } from '../../shared/contracts'

interface Props {
  settings: AppSettings
  selection: SourceSelection | null
  updateStatus: UpdateStatus
  onChange: (settings: AppSettings) => void
  onOpenUpdates: () => void
}

function policyKey(selection: SourceSelection): string {
  if (selection.kind === 'monitor') return `monitor:${selection.captureId}`
  else if (selection.kind === 'window') return `window:${selection.label}`
  else if (selection.kind === 'region') return `region:${selection.captureId}:${selection.region?.x ?? 0}:${selection.region?.y ?? 0}:${selection.region?.width ?? 0}:${selection.region?.height ?? 0}`
  else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
}

export function SettingsPanel({ settings, selection, updateStatus, onChange, onOpenUpdates }: Props) {
  const fallback: FramePolicy = { format: settings.format, jpegQuality: settings.jpegQuality, maxLongSide: settings.maxLongSide }
  const policy = selection ? settings.sourcePolicies[policyKey(selection)] ?? fallback : fallback
  const updatePolicy = (patch: Partial<FramePolicy>): void => { void window.screenmcp.setFramePolicy({ ...policy, ...patch }).then(onChange) }
  const updateSettings = (patch: Partial<AppSettings>): void => { void window.screenmcp.updateSettings(patch).then(onChange) }
  const updateUpdateSettings = (patch: Partial<AppSettings['updates']>): void => updateSettings({ updates: { ...settings.updates, ...patch } })
  const checkNow = (): void => { onOpenUpdates(); void window.screenmcp.checkForUpdates() }
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.screenmcp.getShortcutStatus().then(status => { if (live) setShortcutStatus(status) })
    return () => { live = false }
  }, [settings.shortcuts])
  const setShortcut = (action: ShortcutAction, accelerator: string | null): void => updateSettings({ shortcuts: { ...settings.shortcuts, [action]: accelerator } })
  return (
    <section className="settings-panel">
      <div><p className="eyebrow">FRAME POLICY</p><h2>{selection ? 'Current source' : 'Select a source first'}</h2></div>
      <div className="settings-grid">
        <label><span>Format</span><select value={policy.format} disabled={!selection} onChange={event => updatePolicy({ format: event.target.value as FramePolicy['format'] })}><option value="jpeg">JPEG — efficient</option><option value="png">PNG — crisp, expensive</option></select></label>
        <label><span>Longest side</span><select value={policy.maxLongSide ?? 'full'} disabled={!selection} onChange={event => updatePolicy({ maxLongSide: event.target.value === 'full' ? null : Number(event.target.value) })}><option value="1280">1280 px</option><option value="1568">1568 px — default</option><option value="2048">2048 px</option><option value="full">Full resolution</option></select></label>
        <label className="range-setting"><span>JPEG quality · {policy.jpegQuality}</span><input type="range" min="40" max="95" value={policy.jpegQuality} disabled={!selection || policy.format !== 'jpeg'} onChange={event => updatePolicy({ jpegQuality: Number(event.target.value) })} /></label>
      </div>
      <p className="settings-note">Full-resolution PNG can be costly for vision models. Frame metadata is returned separately as text.</p>
      <div className="settings-divider" />
      <div><p className="eyebrow">APP BEHAVIOR</p><h2>Window, startup, and retention</h2></div>
      <div className="settings-grid">
        <label><span>Close button</span><select value={settings.closeAction} onChange={event => updateSettings({ closeAction: event.target.value as AppSettings['closeAction'] })}><option value="tray">Hide to tray</option><option value="quit">Quit application</option></select></label>
        <label><span>Access mode default</span><select value={settings.accessModeDefault} onChange={event => updateSettings({ accessModeDefault: event.target.value as AppSettings['accessModeDefault'] })}><option value="read-only">Read-only</option><option value="off">Off</option></select></label>
        <label><span>Audit frames retained</span><input type="number" min="0" max="1000" value={settings.auditThumbnailRetention} onChange={event => updateSettings({ auditThumbnailRetention: Number(event.target.value) })} /></label>
        <label className="checkbox-setting"><input type="checkbox" checked={settings.followActiveDialogs} onChange={event => updateSettings({ followActiveDialogs: event.target.checked })} /><span>Follow active dialogs</span></label>
      </div>
      <p className="settings-note">The access default applies after the next app start. On Windows, active modal dialogs can replace a selected parent window until they close; every switch requires a fresh Interactive grant.</p>
      <div className="settings-divider" />
      <div><p className="eyebrow">SHORTCUTS</p><h2>Global picker keys</h2></div>
      <div className="settings-grid">
        <ShortcutField label="Pick region" value={settings.shortcuts.pickRegion} status={shortcutStatus?.pickRegion ?? null} onChange={accelerator => setShortcut('pickRegion', accelerator)} />
        <ShortcutField label="Pick window" value={settings.shortcuts.pickWindow} status={shortcutStatus?.pickWindow ?? null} onChange={accelerator => setShortcut('pickWindow', accelerator)} />
      </div>
      <p className="settings-note">Shortcuts work while ScreenMCP sits in the tray. Click a field, then press the new combination — Esc cancels, × disables. Letters, digits, and editing keys need a modifier.</p>
      <div className="settings-divider" />
      <div><p className="eyebrow">UPDATES</p><h2>Release checks</h2></div>
      <div className="settings-grid update-settings-grid">
        <label className="checkbox-setting"><input type="checkbox" checked={settings.updates.autoCheck} onChange={event => updateUpdateSettings({ autoCheck: event.target.checked })} /><span>Check automatically after startup</span></label>
        <label><span>Check interval</span><select value={settings.updates.checkIntervalMinutes} onChange={event => updateUpdateSettings({ checkIntervalMinutes: Number(event.target.value) })}><option value="15">Every 15 minutes</option><option value="60">Every hour</option><option value="120">Every 2 hours</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Daily</option></select></label>
      </div>
      <div className="update-settings-status">
        <strong>{updateStatusSummary(updateStatus)}</strong>
        <span>{updateStatus.reason}</span>
        <small>{updateStatus.lastCheckAt ? `Last check ${new Date(updateStatus.lastCheckAt).toLocaleString()} · ${updateStatus.lastCheckOutcome ?? 'no result'}` : 'Not checked in this run.'}</small>
      </div>
      <div className="settings-actions"><button className="primary-button" onClick={checkNow}>Check now</button><button onClick={() => void window.screenmcp.openReleasePage()}>Open GitHub Releases</button></div>
      <p className="settings-note">Automatic schedule changes apply after restarting ScreenMCP. Downloads and restarts always require your explicit action.</p>
    </section>
  )
}

function ShortcutField({ label, value, status, onChange }: { label: string; value: string | null; status: ShortcutStatus[ShortcutAction] | null; onChange: (accelerator: string | null) => void }) {
  const [recording, setRecording] = useState(false)
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { setRecording(false); return }
    const accelerator = acceleratorFromEvent(event)
    if (!accelerator) return
    setRecording(false)
    onChange(accelerator)
  }
  return (
    <div className="shortcut-setting">
      <span>{label}{status === 'unavailable' && <em className="shortcut-warning"> · key is in use by another application</em>}</span>
      <span className="shortcut-controls">
        <button type="button" className={recording ? 'shortcut-field recording' : 'shortcut-field'} onClick={() => setRecording(true)} onKeyDown={onKeyDown} onBlur={() => setRecording(false)}>{recording ? 'Press keys…' : value ?? 'Disabled'}</button>
        <button type="button" className="shortcut-clear" title="Disable this shortcut" disabled={value === null} onClick={() => onChange(null)}>×</button>
      </span>
    </div>
  )
}

// only these keys make sense as a global shortcut without a modifier
const STANDALONE_KEY = /^(F([1-9]|1[0-9]|2[0-4])|Scrolllock|PrintScreen)$/

function acceleratorFromEvent(event: ReactKeyboardEvent): string | null {
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter((modifier): modifier is string => Boolean(modifier))
  const key = acceleratorKey(event)
  if (!key) return null
  if (modifiers.length === 0 && !STANDALONE_KEY.test(key)) return null
  return [...modifiers, key].join('+')
}

// maps a DOM key event to an Electron accelerator key name; null = not recordable
function acceleratorKey(event: ReactKeyboardEvent): string | null {
  const { code, key } = event
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  if (key === 'ScrollLock') return 'Scrolllock'
  if (key === 'PrintScreen') return 'PrintScreen'
  const named: Record<string, string> = { ' ': 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
  return named[key] ?? null
}

function updateStatusSummary(status: UpdateStatus): string {
  if (status.channel === 'none') return 'Manual update channel'
  else if (status.channel !== 'github') throw new Error(`Unknown update channel: ${JSON.stringify(status.channel)}`)
  if (status.phase === 'idle') return status.lastCheckOutcome ?? `Running ${status.running}`
  else if (status.phase === 'checking') return 'Checking GitHub Releases…'
  else if (status.phase === 'available') return `Version ${status.pendingVersion ?? ''} is available`
  else if (status.phase === 'downloading') return `Downloading ${status.pendingVersion ?? ''} · ${Math.round(status.progress?.percent ?? 0)}%`
  else if (status.phase === 'ready') return `Version ${status.pendingVersion ?? ''} is ready to install`
  else if (status.phase === 'installing') return `Installing ${status.pendingVersion ?? ''}`
  else if (status.phase === 'error') return status.lastError ?? 'Update failed'
  else throw new Error(`Unknown update phase: ${JSON.stringify(status.phase)}`)
}
