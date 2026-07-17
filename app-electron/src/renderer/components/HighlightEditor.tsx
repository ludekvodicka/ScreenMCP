import { useEffect, useState, type KeyboardEvent } from 'react'
import { HIGHLIGHT_MAX_PER_SOURCE, type HighlightRect, type Rect } from '../../shared/contracts'
import { RectangleEditor } from './RectangleEditor'

interface Props {
  sourceWidth: number
  sourceHeight: number
  highlights: HighlightRect[]
  editing: boolean
  onChange: (highlights: HighlightRect[]) => void
  onDone: () => void
}

export function HighlightEditor({ sourceWidth, sourceHeight, highlights, editing, onChange, onDone }: Props) {
  function commitLabel(id: string, label: string | undefined): void {
    onChange(highlights.map(highlight => highlight.id === id ? { ...highlight, ...(label === undefined ? { label: undefined } : { label }) } : highlight))
  }

  return (
    <RectangleEditor sourceWidth={sourceWidth} sourceHeight={sourceHeight} rectangles={highlights} drawing={editing} canDraw={highlights.length < HIGHLIGHT_MAX_PER_SOURCE} layerClassName="highlight-layer" rectangleClassName="highlight-rect" instructionClassName="highlight-instruction" instruction={<>Drag to point out an area · Hold Ctrl to move the draft{highlights.length >= HIGHLIGHT_MAX_PER_SOURCE && ` · limit ${HIGHLIGHT_MAX_PER_SOURCE}`}</>} itemName={(_highlight, index) => `highlight ${index + 1}`} createRectangle={(rect: Rect): HighlightRect => ({ id: crypto.randomUUID(), shape: 'rect', ...rect })} renderRectangle={(highlight, index) => <><span className="highlight-badge">{index + 1}</span><HighlightLabel number={index + 1} highlight={highlight} onCommit={label => commitLabel(highlight.id, label)} /></>} renderDraft={(_rect, index) => <span className="highlight-badge">{index + 1}</span>} onChange={onChange} onDone={onDone} />
  )
}

function HighlightLabel({ number, highlight, onCommit }: { number: number; highlight: HighlightRect; onCommit: (label: string | undefined) => void }) {
  const [value, setValue] = useState(highlight.label ?? '')

  useEffect(() => setValue(highlight.label ?? ''), [highlight.label])

  function commit(input: string): void {
    const label = input.trim().slice(0, 120)
    setValue(label)
    onCommit(label || undefined)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return <input className="highlight-label" aria-label={`Label highlight ${number}`} maxLength={120} placeholder="label for the model…" value={value} onChange={event => setValue(event.currentTarget.value)} onPointerDown={event => event.stopPropagation()} onBlur={event => commit(event.currentTarget.value)} onKeyDown={keyDown} />
}
