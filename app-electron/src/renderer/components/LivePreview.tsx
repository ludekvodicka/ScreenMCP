import { useEffect, useState, type CSSProperties } from 'react'
import type { HighlightRect, MaskRect, PreviewFrame, SourceSelection } from '../../shared/contracts'
import { HighlightEditor } from './HighlightEditor'
import { MaskEditor } from './MaskEditor'

interface Props {
  selection: SourceSelection | null
  onClear: () => void
}

export function LivePreview({ selection, onClear }: Props) {
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<'masks' | 'highlights' | null>(null)
  const [masks, setMasks] = useState<MaskRect[]>([])
  const [highlights, setHighlights] = useState<HighlightRect[]>([])
  const canvasStyle = previewCanvasStyle(frame?.width ?? selection?.width ?? 16, frame?.height ?? selection?.height ?? 10)

  useEffect(() => {
    setFrame(null)
    if (!selection) { setError(null); return }
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.screenmcp.getPreview()
        if (active) { setFrame(next); setError(null) }
      } catch (reason) {
        if (active) { setFrame(null); setError(reason instanceof Error ? reason.message : String(reason)) }
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 750)
    return () => { active = false; clearInterval(timer) }
  }, [selection?.captureId, selection?.kind, selection?.region?.x, selection?.region?.y, selection?.region?.width, selection?.region?.height])

  useEffect(() => {
    if (editing === null) return
    const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setEditing(null) }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [editing])

  useEffect(() => {
    setMasks([])
    setHighlights([])
    setEditing(null)
    if (!selection) return
    let active = true
    void window.screenmcp.getMasks().then(next => { if (active) setMasks(next) }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    void window.screenmcp.getHighlights().then(next => { if (active) setHighlights(next) }, reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [selection?.captureId, selection?.kind, selection?.region?.x, selection?.region?.y, selection?.region?.width, selection?.region?.height])

  function updateMasks(next: MaskRect[]): void {
    setMasks(next)
    void window.screenmcp.setMasks(next).then(setMasks, reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  function updateHighlights(next: HighlightRect[]): void {
    setHighlights(next)
    void window.screenmcp.setHighlights(next).then(setHighlights, reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  function toggleEditing(mode: 'masks' | 'highlights'): void {
    setEditing(current => {
      if (current === null) return mode
      else if (current === 'masks') {
        if (mode === 'masks') return null
        else if (mode === 'highlights') return 'highlights'
        else throw new Error(`Unknown editor mode: ${JSON.stringify(mode)}`)
      } else if (current === 'highlights') {
        if (mode === 'masks') return 'masks'
        else if (mode === 'highlights') return null
        else throw new Error(`Unknown editor mode: ${JSON.stringify(mode)}`)
      } else throw new Error(`Unknown active editor: ${JSON.stringify(current)}`)
    })
  }

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <div><p className="eyebrow">VISIBLE TO THE MODEL</p><strong title={selection?.label}>{selection?.label ?? 'Nothing shared yet'}</strong></div>
        {selection && <div className="toolbar-actions">
          <button type="button" className={editing === 'masks' ? 'active' : ''} onClick={() => toggleEditing('masks')}>Add redaction{masks.length ? ` · ${masks.length}` : ''}</button>
          <button type="button" className={`highlight-toggle${editing === 'highlights' ? ' active' : ''}`} onClick={() => toggleEditing('highlights')}>Add highlight{highlights.length ? ` · ${highlights.length}` : ''}</button>
          <button onClick={onClear}>Clear source</button>
        </div>}
      </div>
      <div className={selection ? 'preview-stage' : 'preview-stage empty-preview'}>
        <div className="preview-canvas" style={canvasStyle}>
          {frame && selection ? <img src={frame.dataUrl} alt={`Exact model view of ${selection.label}`} /> : selection ? <span>{error ?? 'Preparing the first model frame…'}</span> : <div className="preview-empty-content"><span className="preview-empty-icon">◎</span><strong>No pixels are shared</strong><small>Choose Rectangle, Window, or Whole screen to start capture.</small></div>}
          {frame && selection && <MaskEditor sourceWidth={selection.width} sourceHeight={selection.height} masks={masks} editing={editing === 'masks'} onChange={updateMasks} onDone={() => setEditing(null)} />}
          {frame && selection && <HighlightEditor sourceWidth={selection.width} sourceHeight={selection.height} highlights={highlights} editing={editing === 'highlights'} onChange={updateHighlights} onDone={() => setEditing(null)} />}
        </div>
      </div>
      <div className="preview-meta"><span>{selection?.kind ?? 'OFF'}</span><span>{frame ? `${frame.width} × ${frame.height} · ${frame.format.toUpperCase()}` : 'No image'}</span><span>{frame ? new Date(frame.capturedAt).toLocaleTimeString() : '—'}</span></div>
    </section>
  )
}

export function previewCanvasStyle(width: number, height: number): CSSProperties {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new RangeError('Preview dimensions must be positive')
  return { aspectRatio: `${width}/${height}`, maxWidth: `calc((100vh - 250px) * ${width / height})` }
}
