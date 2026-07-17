import { useEffect } from 'react'
import type { CaptureSource } from '../../shared/contracts'

interface Props {
  screens: CaptureSource[]
  loading: boolean
  busy: boolean
  error: string | null
  onSelect: (screen: CaptureSource) => void
  onCancel: () => void
}

export function ScreenPickerDialog({ screens, loading, busy, error, onSelect, onCancel }: Props) {
  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [onCancel])

  return (
    <div className="modal-backdrop screen-picker-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="screen-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="screen-picker-title">
        <div className="screen-picker-heading">
          <div><p className="eyebrow">WHOLE SCREEN</p><h2 id="screen-picker-title">Choose a display</h2><span>Only the selected display will be visible to the model.</span></div>
          <button className="dialog-close" disabled={busy} onClick={onCancel} aria-label="Close display picker">×</button>
        </div>
        {error && <p className="inline-error">{error}</p>}
        {loading ? <div className="screen-picker-loading">Finding connected displays…</div> : (
          <div className="screen-grid">
            {screens.map((screen, index) => (
              <button className="screen-card" key={screen.id} disabled={busy} onClick={() => onSelect(screen)}>
                <span className="screen-thumbnail">{screen.thumbnailDataUrl ? <img src={screen.thumbnailDataUrl} alt={`Preview of ${screen.label}`} /> : <span>Preview unavailable</span>}<b>DISPLAY {index + 1}</b></span>
                <span className="screen-name"><strong title={screen.label}>{screen.label}</strong><small>{screen.width && screen.height ? `${screen.width} × ${screen.height}` : 'Whole display'}</small></span>
              </button>
            ))}
          </div>
        )}
        {!loading && screens.length === 0 && !error && <div className="screen-picker-loading">No displays are available.</div>}
      </section>
    </div>
  )
}
