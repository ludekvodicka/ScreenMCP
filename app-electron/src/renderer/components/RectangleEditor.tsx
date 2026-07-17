import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { Rect } from '../../shared/contracts'

export const RECTANGLE_MIN_SIZE = 6

export interface Point { x: number; y: number }
export type ResizeEdge = 'top' | 'right' | 'bottom' | 'left'
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
export type ResizeHandle = ResizeEdge | ResizeCorner

export type RectangleInteraction =
  | { kind: 'draw'; anchor: Point; active: Point; pointer: Point; rect: Rect }
  | { kind: 'move'; id: string; start: Point; origin: Rect; rect: Rect }
  | { kind: 'resize'; id: string; handle: ResizeHandle; start: Point; origin: Rect; rect: Rect }

interface RectangleItem extends Rect { id: string }

interface Props<T extends RectangleItem> {
  sourceWidth: number
  sourceHeight: number
  rectangles: T[]
  drawing: boolean
  canDraw: boolean
  layerClassName: string
  rectangleClassName: string
  instructionClassName: string
  instruction: ReactNode
  itemName: (rectangle: T, index: number) => string
  createRectangle: (rect: Rect) => T
  renderRectangle?: (rectangle: T, index: number) => ReactNode
  renderDraft?: (rect: Rect, index: number) => ReactNode
  onChange: (rectangles: T[]) => void
  onDone: () => void
}

const RESIZE_HANDLES: ResizeHandle[] = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-right', 'bottom-left']

export function RectangleEditor<T extends RectangleItem>({ sourceWidth, sourceHeight, rectangles, drawing, canDraw, layerClassName, rectangleClassName, instructionClassName, instruction, itemName, createRectangle, renderRectangle, renderDraft, onChange, onDone }: Props<T>) {
  const layer = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<RectangleInteraction | null>(null)
  const [interaction, setRenderedInteraction] = useState<RectangleInteraction | null>(null)

  useEffect(() => {
    if (!drawing && interactionRef.current?.kind === 'draw') {
      interactionRef.current = null
      setRenderedInteraction(null)
    }
  }, [drawing])

  function setInteraction(next: RectangleInteraction | null): void {
    interactionRef.current = next
    setRenderedInteraction(next)
  }

  function point(event: PointerEvent<HTMLElement>): Point {
    const bounds = layer.current!.getBoundingClientRect()
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * sourceWidth, 0, sourceWidth),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * sourceHeight, 0, sourceHeight),
    }
  }

  function capture(event: PointerEvent<HTMLElement>, next: RectangleInteraction): void {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction(next)
  }

  function startDraw(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !drawing || !canDraw || event.target !== event.currentTarget) return
    const start = point(event)
    capture(event, createDrawInteraction(start))
  }

  function startMove(event: PointerEvent<HTMLButtonElement>, rectangle: T): void {
    if (event.button !== 0) return
    const start = point(event)
    const origin = geometry(rectangle)
    capture(event, { kind: 'move', id: rectangle.id, start, origin, rect: origin })
  }

  function startResize(event: PointerEvent<HTMLSpanElement>, rectangle: T, handle: ResizeHandle): void {
    if (event.button !== 0) return
    const start = point(event)
    const origin = geometry(rectangle)
    capture(event, { kind: 'resize', id: rectangle.id, handle, start, origin, rect: origin })
  }

  function move(event: PointerEvent<HTMLDivElement>): void {
    const active = interactionRef.current
    if (!active) return
    setInteraction(advanceRectangleInteraction(active, point(event), event.ctrlKey, sourceWidth, sourceHeight))
  }

  function finish(event: PointerEvent<HTMLDivElement>): void {
    const active = interactionRef.current
    if (!active) return
    const completed = advanceRectangleInteraction(active, point(event), event.ctrlKey, sourceWidth, sourceHeight)
    setInteraction(null)
    if (completed.kind === 'draw') {
      if (completed.rect.width >= RECTANGLE_MIN_SIZE && completed.rect.height >= RECTANGLE_MIN_SIZE)
        onChange([...rectangles, createRectangle(completed.rect)])
    } else if (completed.kind === 'move' || completed.kind === 'resize')
      onChange(rectangles.map(rectangle => rectangle.id === completed.id ? { ...rectangle, ...completed.rect } : rectangle))
    else
      throw new Error(`Unknown rectangle interaction: ${JSON.stringify(completed)}`)
  }

  function cancel(): void {
    if (interactionRef.current) setInteraction(null)
  }

  return (
    <div ref={layer} className={`${layerClassName}${drawing ? ' editing' : ''}`} data-rectangle-editor={layerClassName} onPointerDown={startDraw} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {drawing && <div className={instructionClassName}>{instruction} <button type="button" onPointerDown={event => event.stopPropagation()} onClick={onDone}>Done</button></div>}
      {rectangles.map((rectangle, index) => {
        const visibleRect = visibleGeometry(rectangle, interaction)
        const visibleRectangle = { ...rectangle, ...visibleRect }
        const name = itemName(rectangle, index)
        return (
          <div key={rectangle.id} className={`rectangle-editor-rect ${rectangleClassName}`} data-rectangle-id={rectangle.id} style={rectangleStyle(visibleRect, sourceWidth, sourceHeight)}>
            <button type="button" tabIndex={-1} className="rectangle-move" data-rectangle-action="move" aria-label={`Move ${name}`} title={`Move ${name}`} onPointerDown={event => startMove(event, rectangle)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 5.5 3.5h1.7v3.7H3.5V5.5L1 8l2.5 2.5V8.8h3.7v3.7H5.5L8 15l2.5-2.5H8.8V8.8h3.7v1.7L15 8l-2.5-2.5v1.7H8.8V3.5h1.7z" /></svg>
            </button>
            {RESIZE_HANDLES.map(handle => <span key={handle} className={`rectangle-resize ${handle}`} data-rectangle-action="resize" data-resize-handle={handle} title={`Resize ${name} from ${handle.replace('-', ' ')}`} onPointerDown={event => startResize(event, rectangle, handle)} />)}
            {renderRectangle?.(visibleRectangle, index)}
            <button type="button" className="rectangle-delete" data-rectangle-action="delete" aria-label={`Delete ${name}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onChange(rectangles.filter(item => item.id !== rectangle.id)) }}>×</button>
          </div>
        )
      })}
      {interaction?.kind === 'draw' && <div className={`rectangle-editor-rect ${rectangleClassName} draft`} data-rectangle-draft="true" style={rectangleStyle(interaction.rect, sourceWidth, sourceHeight)}>{renderDraft?.(interaction.rect, rectangles.length)}</div>}
    </div>
  )
}

export function createDrawInteraction(start: Point): Extract<RectangleInteraction, { kind: 'draw' }> {
  return { kind: 'draw', anchor: start, active: start, pointer: start, rect: { x: start.x, y: start.y, width: 0, height: 0 } }
}

export function advanceRectangleInteraction(interaction: RectangleInteraction, current: Point, ctrlKey: boolean, sourceWidth: number, sourceHeight: number): RectangleInteraction {
  const bounded = { x: clamp(current.x, 0, sourceWidth), y: clamp(current.y, 0, sourceHeight) }
  if (interaction.kind === 'draw') {
    if (ctrlKey) {
      const rect = translateRectangle(interaction.rect, bounded.x - interaction.pointer.x, bounded.y - interaction.pointer.y, sourceWidth, sourceHeight)
      const dx = rect.x - interaction.rect.x
      const dy = rect.y - interaction.rect.y
      return { kind: 'draw', anchor: offset(interaction.anchor, dx, dy), active: offset(interaction.active, dx, dy), pointer: bounded, rect }
    }
    const active = {
      x: clamp(bounded.x + interaction.active.x - interaction.pointer.x, 0, sourceWidth),
      y: clamp(bounded.y + interaction.active.y - interaction.pointer.y, 0, sourceHeight),
    }
    return { ...interaction, active, pointer: bounded, rect: normalizeRectangle(interaction.anchor, active) }
  } else if (interaction.kind === 'move') {
    const rect = translateRectangle(interaction.origin, bounded.x - interaction.start.x, bounded.y - interaction.start.y, sourceWidth, sourceHeight)
    return { ...interaction, rect }
  } else if (interaction.kind === 'resize') {
    const rect = resizeRectangleByDelta(interaction.origin, interaction.handle, bounded.x - interaction.start.x, bounded.y - interaction.start.y, sourceWidth, sourceHeight)
    return { ...interaction, rect }
  } else
    throw new Error(`Unknown rectangle interaction: ${JSON.stringify(interaction)}`)
}

export function normalizeRectangle(start: Point, end: Point): Rect {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) }
}

export function translateRectangle(rect: Rect, dx: number, dy: number, sourceWidth: number, sourceHeight: number): Rect {
  return { ...rect, x: clamp(rect.x + dx, 0, Math.max(0, sourceWidth - rect.width)), y: clamp(rect.y + dy, 0, Math.max(0, sourceHeight - rect.height)) }
}

export function resizeRectangle(rect: Rect, edge: ResizeEdge, current: Point, sourceWidth: number, sourceHeight: number, minimum = RECTANGLE_MIN_SIZE): Rect {
  if (edge === 'top') {
    const bottom = rect.y + rect.height
    const y = clamp(current.y, 0, bottom - minimum)
    return { ...rect, y, height: bottom - y }
  } else if (edge === 'right') {
    const right = clamp(current.x, rect.x + minimum, sourceWidth)
    return { ...rect, width: right - rect.x }
  } else if (edge === 'bottom') {
    const bottom = clamp(current.y, rect.y + minimum, sourceHeight)
    return { ...rect, height: bottom - rect.y }
  } else if (edge === 'left') {
    const right = rect.x + rect.width
    const x = clamp(current.x, 0, right - minimum)
    return { ...rect, x, width: right - x }
  } else
    throw new Error(`Unknown rectangle resize edge: ${JSON.stringify(edge)}`)
}

export function resizeRectangleByDelta(rect: Rect, handle: ResizeHandle, dx: number, dy: number, sourceWidth: number, sourceHeight: number, minimum = RECTANGLE_MIN_SIZE): Rect {
  if (handle === 'top') return resizeRectangle(rect, handle, { x: rect.x, y: rect.y + dy }, sourceWidth, sourceHeight, minimum)
  else if (handle === 'right') return resizeRectangle(rect, handle, { x: rect.x + rect.width + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
  else if (handle === 'bottom') return resizeRectangle(rect, handle, { x: rect.x, y: rect.y + rect.height + dy }, sourceWidth, sourceHeight, minimum)
  else if (handle === 'left') return resizeRectangle(rect, handle, { x: rect.x + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
  else if (handle === 'top-left') {
    const resized = resizeRectangle(rect, 'left', { x: rect.x + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
    return resizeRectangle(resized, 'top', { x: rect.x, y: rect.y + dy }, sourceWidth, sourceHeight, minimum)
  } else if (handle === 'top-right') {
    const resized = resizeRectangle(rect, 'right', { x: rect.x + rect.width + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
    return resizeRectangle(resized, 'top', { x: rect.x, y: rect.y + dy }, sourceWidth, sourceHeight, minimum)
  } else if (handle === 'bottom-right') {
    const resized = resizeRectangle(rect, 'right', { x: rect.x + rect.width + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
    return resizeRectangle(resized, 'bottom', { x: rect.x, y: rect.y + rect.height + dy }, sourceWidth, sourceHeight, minimum)
  } else if (handle === 'bottom-left') {
    const resized = resizeRectangle(rect, 'left', { x: rect.x + dx, y: rect.y }, sourceWidth, sourceHeight, minimum)
    return resizeRectangle(resized, 'bottom', { x: rect.x, y: rect.y + rect.height + dy }, sourceWidth, sourceHeight, minimum)
  } else
    throw new Error(`Unknown rectangle resize handle: ${JSON.stringify(handle)}`)
}

function visibleGeometry(rectangle: RectangleItem, interaction: RectangleInteraction | null): Rect {
  if (interaction?.kind === 'move' && interaction.id === rectangle.id) return interaction.rect
  else if (interaction?.kind === 'resize' && interaction.id === rectangle.id) return interaction.rect
  else return geometry(rectangle)
}

function geometry(rectangle: Rect): Rect {
  return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
}

function rectangleStyle(rect: Rect, width: number, height: number): CSSProperties {
  return { left: `${(rect.x / width) * 100}%`, top: `${(rect.y / height) * 100}%`, width: `${(rect.width / width) * 100}%`, height: `${(rect.height / height) * 100}%` }
}

function offset(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
