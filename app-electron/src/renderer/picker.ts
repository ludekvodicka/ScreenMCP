import type { PickerMode, PickerOverlayState, Rect } from '../shared/contracts'
import './picker.css'

interface Point { x: number; y: number }

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing picker element: ${selector}`)
  return element
}

const root = requiredElement<HTMLDivElement>('#picker-root')
const instruction = requiredElement<HTMLDivElement>('#picker-instruction')
const selection = requiredElement<HTMLDivElement>('#picker-selection')
const target = requiredElement<HTMLDivElement>('#picker-target')
const targetLabel = requiredElement<HTMLSpanElement>('#picker-target span')
const error = requiredElement<HTMLDivElement>('#picker-error')

let mode: PickerMode | null = null
let displayBounds: Rect | null = null
let start: Point | null = null
let pointerFrame: number | null = null
let pendingPointer: Point | null = null

window.pickerOverlay.onState(state => {
  if (state.kind === 'config') configure(state)
  else if (state.kind === 'target') showTarget(state.target)
  else if (state.kind === 'error') showError(state.message)
  else throw new Error(`Unknown picker state: ${JSON.stringify(state)}`)
})

root.addEventListener('pointerdown', event => {
  if (event.button === 2) { window.pickerOverlay.cancel(); return }
  if (event.button !== 0 || !mode) return
  const point = localPoint(event)
  if (mode === 'rectangle') {
    start = point
    root.setPointerCapture(event.pointerId)
    showSelection(point, point)
  } else if (mode === 'window') window.pickerOverlay.selectWindow(point)
  else throw new Error(`Unknown picker mode: ${JSON.stringify(mode)}`)
})

root.addEventListener('pointermove', event => {
  const point = localPoint(event)
  if (mode === 'rectangle') {
    if (start) showSelection(start, point)
  } else if (mode === 'window') queuePointer(point)
  else if (mode !== null) throw new Error(`Unknown picker mode: ${JSON.stringify(mode)}`)
})

root.addEventListener('pointerup', event => {
  if (event.button !== 0 || mode !== 'rectangle' || !start) return
  const first = start
  const last = localPoint(event)
  start = null
  selection.style.display = 'none'
  window.pickerOverlay.selectRectangle(first, last)
})

root.addEventListener('contextmenu', event => {
  event.preventDefault()
  window.pickerOverlay.cancel()
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.pickerOverlay.cancel()
})

function configure(state: Extract<PickerOverlayState, { kind: 'config' }>): void {
  mode = state.mode
  displayBounds = state.displayBounds
  root.className = state.mode
  instruction.innerHTML = state.mode === 'rectangle'
    ? '<b>Drag</b> a region · Esc to cancel'
    : '<b>Point</b> at a window and click · Esc to cancel'
}

function showTarget(next: Extract<PickerOverlayState, { kind: 'target' }>['target']): void {
  if (!next || !displayBounds) { target.style.display = 'none'; return }
  setRect(target, { x: next.bounds.x - displayBounds.x, y: next.bounds.y - displayBounds.y, width: next.bounds.width, height: next.bounds.height })
  targetLabel.textContent = next.label
  target.style.display = 'block'
}

function showError(message: string): void {
  error.textContent = message
  error.style.display = 'block'
  setTimeout(() => { if (error.textContent === message) error.style.display = 'none' }, 2_500)
}

function showSelection(first: Point, last: Point): void {
  setRect(selection, { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), width: Math.abs(first.x - last.x), height: Math.abs(first.y - last.y) })
  selection.style.display = 'block'
}

function setRect(element: HTMLElement, rect: Rect): void {
  element.style.left = `${rect.x}px`
  element.style.top = `${rect.y}px`
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
}

function localPoint(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY }
}

function queuePointer(point: Point): void {
  pendingPointer = point
  if (pointerFrame !== null) return
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null
    if (pendingPointer) window.pickerOverlay.pointer(pendingPointer)
    pendingPointer = null
  })
}
