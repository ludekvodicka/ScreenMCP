import { useEffect, useRef, useState } from 'react'
import { accessMode, accessModeLabel } from '../shared/access-mode'
import type { AppSettings, BootstrapState, CaptureSource, PickerMode, SourceSelection } from '../shared/contracts'
import { AuditPanel } from './components/AuditPanel'
import { ControlPanel } from './components/ControlPanel'
import { InteractiveRequestDialog } from './components/InteractiveRequestDialog'
import { LivePreview } from './components/LivePreview'
import { RecentActivityChip } from './components/RecentActivityChip'
import { SettingsPanel } from './components/SettingsPanel'
import { ScreenPickerDialog } from './components/ScreenPickerDialog'
import { SourcePicker } from './components/SourcePicker'
import { StatusChip } from './components/StatusChip'
import { StopButton } from './components/StopButton'
import { UpdateChip } from './components/UpdateChip'
import { UpdateDialog } from './components/UpdateDialog'

type Tab = 'source' | 'audit' | 'settings'

export function App() {
  const [state, setState] = useState<BootstrapState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('source')
  const [screenPickerOpen, setScreenPickerOpen] = useState(false)
  const [screens, setScreens] = useState<CaptureSource[]>([])
  const [loadingScreens, setLoadingScreens] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const interactiveRequestEvent = useRef<BootstrapState['interactiveRequests'] | null>(null)

  useEffect(() => {
    const unsubscribers = [
      window.screenmcp.onCaptureState(captureState => setState(current => current ? { ...current, captureState } : current)),
      window.screenmcp.onStopped(stopped => setState(current => current ? { ...current, stopped } : current)),
      window.screenmcp.onControlState(controlState => setState(current => current ? { ...current, controlState } : current)),
      window.screenmcp.onInteractiveRequests(interactiveRequests => {
        interactiveRequestEvent.current = interactiveRequests
        setState(current => current ? { ...current, interactiveRequests } : current)
      }),
      window.screenmcp.onSourceChanged(selection => setState(current => current ? { ...current, selection } : current)),
      window.screenmcp.onUpdateStatus(updateStatus => setState(current => current ? { ...current, updateStatus } : current)),
      window.screenmcp.onUpdatePrompt(() => setUpdateDialogOpen(true)),
      window.screenmcp.onUpdateOpen(() => setUpdateDialogOpen(true)),
    ]
    void window.screenmcp.getBootstrapState().then(initial => setState({ ...initial, interactiveRequests: interactiveRequestEvent.current ?? initial.interactiveRequests }))
    return () => { for (const unsubscribe of unsubscribers) unsubscribe() }
  }, [])

  async function pickSource(mode: PickerMode): Promise<void> {
    setBusy(true)
    try {
      const selection = await window.screenmcp.pickSource(mode)
      if (selection) setState(current => current ? { ...current, selection } : current)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function selectPortal(): Promise<void> {
    setBusy(true)
    try {
      const selection = await window.screenmcp.selectPortalSource()
      setState(current => current ? { ...current, selection } : current)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function openScreenPicker(): Promise<void> {
    setScreenPickerOpen(true)
    setScreens([])
    setLoadingScreens(true)
    setScreenError(null)
    try {
      const next = await window.screenmcp.listSources()
      for (const source of next) {
        if (source.kind === 'monitor') continue
        else if (source.kind === 'window') throw new Error('The display picker received a window source')
        else throw new Error(`Unknown capture source kind: ${JSON.stringify(source.kind)}`)
      }
      setScreens(next)
    } catch (reason) { setScreenError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoadingScreens(false) }
  }

  async function selectScreen(source: CaptureSource): Promise<void> {
    setBusy(true)
    setScreenError(null)
    try {
      if (source.kind === 'monitor') {
        const selection = await window.screenmcp.selectSource({ captureId: source.id, kind: source.kind, label: source.label, ...(source.displayId ? { displayId: source.displayId } : {}) })
        setState(current => current ? { ...current, selection } : current)
      } else if (source.kind === 'window') throw new Error('Only a whole display can be selected here')
      else throw new Error(`Unknown capture source kind: ${JSON.stringify(source.kind)}`)
      setScreenPickerOpen(false)
      setError(null)
    } catch (reason) { setScreenError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function requestPermission(): Promise<void> {
    setBusy(true)
    try {
      const macScreenPermission = await window.screenmcp.requestScreenPermission()
      setState(current => current ? { ...current, macScreenPermission } : current)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  function updateSettings(settings: AppSettings): void {
    setState(current => current ? { ...current, settings } : current)
  }

  if (!state) return <main className="loading">Starting ScreenMCP…</main>
  const selection: SourceSelection | null = state.selection
  const mode = accessMode({ stopped: state.stopped, armed: state.controlState.armed })
  const interactiveRequest = state.interactiveRequests[0]
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark">S</div>
        <div className="brand-copy"><h1>ScreenMCP</h1><span>Human-controlled vision for coding agents</span></div>
        <StatusChip state={state.captureState} stopped={state.stopped} />
        <RecentActivityChip />
        <div className={`mode-chip ${mode}`}><i />{accessModeLabel(mode)}</div>
        <UpdateChip status={state.updateStatus} onClick={() => setUpdateDialogOpen(true)} />
        <StopButton stopped={state.stopped} onToggle={() => void window.screenmcp.setStopped(!state.stopped)} />
      </header>
      <nav className="app-nav">
        <button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>Source</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
        <span>{state.endpoint?.url}</span>
      </nav>
      <div className="app-content">
        {tab === 'source' && (
          <div className="source-layout">
            <div className="source-sidebar">
              <SourcePicker selection={selection} busy={busy} wayland={state.wayland} macScreenPermission={state.macScreenPermission} error={error} onPick={mode => void pickSource(mode)} onScreen={() => void openScreenPicker()} onPortal={() => void selectPortal()} onRequestPermission={() => void requestPermission()} onOpenPermissionSettings={() => void window.screenmcp.openScreenPermissionSettings()} onRelaunch={() => void window.screenmcp.relaunch()} />
              <ControlPanel state={state.controlState} selection={selection} stopped={state.stopped} available={state.platform === 'win32'} />
            </div>
            <LivePreview selection={selection} onClear={() => void window.screenmcp.clearSource()} />
          </div>
        )}
        {tab === 'audit' && <AuditPanel />}
        {tab === 'settings' && <SettingsPanel settings={state.settings} selection={selection} updateStatus={state.updateStatus} onChange={updateSettings} onOpenUpdates={() => setUpdateDialogOpen(true)} />}
      </div>
      {screenPickerOpen && <ScreenPickerDialog screens={screens} loading={loadingScreens} busy={busy} error={screenError} onSelect={source => void selectScreen(source)} onCancel={() => { if (!busy) setScreenPickerOpen(false) }} />}
      {updateDialogOpen && <UpdateDialog status={state.updateStatus} onClose={() => setUpdateDialogOpen(false)} />}
      {interactiveRequest && <InteractiveRequestDialog request={interactiveRequest} onDecision={decision => window.screenmcp.respondInteractiveRequest(interactiveRequest.id, decision)} />}
    </main>
  )
}
