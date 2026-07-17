import { targetDimensions } from '../../../core/capture/src/downscale'
import type { Rect } from '../../../core/mcp/src/control'
import { ScreenMcpError } from '../../../core/mcp/src/errors'
import type { SourceSelection } from '../shared/contracts'
import { parseCaptureWindowId } from './source-picker-geometry'

export interface ScreenPoint {
  x: number
  y: number
}

export interface CoordinateDisplay {
  id: number
  bounds: Rect
  scaleFactor: number
}

export interface CoordinateWindow {
  id: number
  bounds: Rect
}

export interface CoordinateEnvironment {
  platform: NodeJS.Platform
  getAllDisplays(): CoordinateDisplay[]
  dipToScreenPoint(point: ScreenPoint): ScreenPoint
  screenToDipPoint(point: ScreenPoint): ScreenPoint
  windowById(id: number): Promise<CoordinateWindow | null>
}

export class CoordinateResolver {
  constructor(
    private maxLongSide: (selection: SourceSelection) => number | null,
    private environment: CoordinateEnvironment,
  ) {}

  payloadSize(selection: SourceSelection): { width: number; height: number } {
    return targetDimensions(selection.width, selection.height, this.maxLongSide(selection))
  }

  assertPayloadRect(selection: SourceSelection, rect: Rect): void {
    const size = this.payloadSize(selection)
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > size.width || rect.y + rect.height > size.height)
      throw new ScreenMcpError('out_of_bounds', 'Region is outside the selected source')
  }

  async toScreen(selection: SourceSelection, point: ScreenPoint): Promise<ScreenPoint> {
    const payload = this.payloadSize(selection)
    if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x >= payload.width || point.y >= payload.height)
      throw new ScreenMcpError('out_of_bounds', 'Point is outside the selected source')
    const local = {
      x: point.x * selection.width / payload.width,
      y: point.y * selection.height / payload.height,
    }
    if (selection.kind === 'monitor' || selection.kind === 'region') {
      const display = this.display(selection)
      const capture = captureDimensions(selection)
      const frame = selection.kind === 'region'
        ? { x: local.x + selection.region!.x, y: local.y + selection.region!.y }
        : local
      const dip = {
        x: display.bounds.x + frame.x * display.bounds.width / capture.width,
        y: display.bounds.y + frame.y * display.bounds.height / capture.height,
      }
      return roundPoint(this.environment.dipToScreenPoint(dip))
    } else if (selection.kind === 'window') {
      const bounds = await this.windowBounds(selection)
      return roundPoint({
        x: bounds.x + local.x * bounds.width / selection.width,
        y: bounds.y + local.y * bounds.height / selection.height,
      })
    } else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
  }

  async toPayload(selection: SourceSelection, screenRect: Rect, sourceBounds?: Rect): Promise<Rect | null> {
    if (![screenRect.x, screenRect.y, screenRect.width, screenRect.height].every(Number.isFinite) || screenRect.width <= 0 || screenRect.height <= 0) return null
    let first: ScreenPoint
    let last: ScreenPoint
    if (selection.kind === 'monitor' || selection.kind === 'region') {
      const display = this.display(selection)
      const capture = captureDimensions(selection)
      const offset = selection.kind === 'region' ? selection.region! : { x: 0, y: 0 }
      const toLocal = (point: ScreenPoint): ScreenPoint => {
        const dip = this.environment.screenToDipPoint(point)
        return {
          x: (dip.x - display.bounds.x) * capture.width / display.bounds.width - offset.x,
          y: (dip.y - display.bounds.y) * capture.height / display.bounds.height - offset.y,
        }
      }
      first = toLocal({ x: screenRect.x, y: screenRect.y })
      last = toLocal({ x: screenRect.x + screenRect.width, y: screenRect.y + screenRect.height })
    } else if (selection.kind === 'window') {
      const bounds = sourceBounds ?? await this.windowBounds(selection)
      const toLocal = (point: ScreenPoint): ScreenPoint => ({
        x: (point.x - bounds.x) * selection.width / bounds.width,
        y: (point.y - bounds.y) * selection.height / bounds.height,
      })
      first = toLocal({ x: screenRect.x, y: screenRect.y })
      last = toLocal({ x: screenRect.x + screenRect.width, y: screenRect.y + screenRect.height })
    } else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
    const payload = this.payloadSize(selection)
    const left = Math.min(first.x, last.x) * payload.width / selection.width
    const top = Math.min(first.y, last.y) * payload.height / selection.height
    const right = Math.max(first.x, last.x) * payload.width / selection.width
    const bottom = Math.max(first.y, last.y) * payload.height / selection.height
    if (right <= 0 || bottom <= 0 || left >= payload.width || top >= payload.height) return null
    const x = Math.max(0, Math.floor(left))
    const y = Math.max(0, Math.floor(top))
    const clampedRight = Math.min(payload.width, Math.max(x + 1, Math.ceil(right)))
    const clampedBottom = Math.min(payload.height, Math.max(y + 1, Math.ceil(bottom)))
    return { x, y, width: clampedRight - x, height: clampedBottom - y }
  }

  async assertWithinSource(selection: SourceSelection, screenRect: Rect): Promise<void> {
    const source = await this.sourceScreenBounds(selection)
    const tolerance = 1
    if (screenRect.width <= 0 || screenRect.height <= 0 || screenRect.x < source.x - tolerance || screenRect.y < source.y - tolerance || screenRect.x + screenRect.width > source.x + source.width + tolerance || screenRect.y + screenRect.height > source.y + source.height + tolerance)
      throw new ScreenMcpError('out_of_bounds', 'Element is outside the selected source')
  }

  async sourceScreenBounds(selection: SourceSelection): Promise<Rect> {
    if (selection.kind === 'window') return this.windowBounds(selection)
    else if (selection.kind === 'monitor' || selection.kind === 'region') {
      const display = this.display(selection)
      const capture = captureDimensions(selection)
      const frame = selection.kind === 'region'
        ? selection.region!
        : { x: 0, y: 0, width: capture.width, height: capture.height }
      const first = this.environment.dipToScreenPoint({
        x: display.bounds.x + frame.x * display.bounds.width / capture.width,
        y: display.bounds.y + frame.y * display.bounds.height / capture.height,
      })
      const last = this.environment.dipToScreenPoint({
        x: display.bounds.x + (frame.x + frame.width) * display.bounds.width / capture.width,
        y: display.bounds.y + (frame.y + frame.height) * display.bounds.height / capture.height,
      })
      return rectFromPoints(first, last)
    } else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
  }

  private display(selection: SourceSelection): CoordinateDisplay {
    if (this.environment.platform !== 'win32') throw unavailable('Interactive control is available on Windows only')
    const token = selection.displayId || parseCaptureDisplayId(selection.captureId)
    const display = token === null ? undefined : this.environment.getAllDisplays().find(candidate => nativeIdsMatch(candidate.id, token))
    if (!display) throw unavailable('The selected display is no longer available')
    return display
  }

  private async windowBounds(selection: SourceSelection): Promise<Rect> {
    if (this.environment.platform !== 'win32') throw unavailable('Interactive control is available on Windows only')
    const window = await this.environment.windowById(captureHwnd(selection))
    if (!window || window.bounds.width < 1 || window.bounds.height < 1 || window.bounds.x <= -32_000 || window.bounds.y <= -32_000) throw unavailable('The selected window is no longer available')
    return { ...window.bounds }
  }
}

export function captureHwnd(selection: SourceSelection): number {
  if (selection.kind !== 'window') throw new ScreenMcpError('element_actions_unavailable', 'Element actions require a window source')
  const parsed = parseCaptureWindowId(selection.captureId)
  if (!parsed || !isNativeId(parsed.nativeId)) throw unavailable('The selected window has no usable native handle')
  return Number(BigInt.asUintN(32, BigInt(parsed.nativeId)))
}

function captureDimensions(selection: SourceSelection): { width: number; height: number } {
  const width = selection.captureWidth ?? (selection.kind === 'region' ? 0 : selection.width)
  const height = selection.captureHeight ?? (selection.kind === 'region' ? 0 : selection.height)
  if (width < 1 || height < 1) throw unavailable('The selected source has no capture geometry')
  return { width, height }
}

function parseCaptureDisplayId(captureId: string): string | null {
  return /^screen:([^:]+):[01]$/.exec(captureId)?.[1] ?? null
}

function nativeIdsMatch(id: number, token: string): boolean {
  if (!Number.isInteger(id) || !isNativeId(token)) return false
  const parsed = BigInt(token)
  const native = BigInt(id)
  return parsed === native || parsed === BigInt.asIntN(32, native) || parsed === BigInt.asUintN(32, native)
}

function isNativeId(token: string): boolean {
  return /^-?\d+$/.test(token) || /^0x[a-f\d]+$/i.test(token)
}

function rectFromPoints(first: ScreenPoint, last: ScreenPoint): Rect {
  const x = Math.round(Math.min(first.x, last.x))
  const y = Math.round(Math.min(first.y, last.y))
  const right = Math.round(Math.max(first.x, last.x))
  const bottom = Math.round(Math.max(first.y, last.y))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

function roundPoint(point: ScreenPoint): ScreenPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function unavailable(message: string): ScreenMcpError {
  return new ScreenMcpError('control_unavailable', message)
}
