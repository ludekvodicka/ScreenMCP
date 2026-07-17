import type { Rect } from '../shared/contracts'

export interface Point {
  x: number
  y: number
}

export type NormalizedRect = Rect

export interface NativeWindowMetadata {
  id: number
  title: string
  bounds: Rect
  owner: { processId: number }
}

export interface CaptureWindowMetadata {
  id: string
  name: string
}

export interface WindowTarget {
  id: string
  label: string
  bounds: Rect
}

export type RectangleChoice =
  { kind: 'region'; region: NormalizedRect }

export function rectangleChoice(start: Point, end: Point, size: { width: number; height: number }, clickTolerance = 6, minimumSize = 12): RectangleChoice | null {
  if (size.width < 1 || size.height < 1) throw new RangeError('Picker display size must be positive')
  const first = clampPoint(start, size)
  const last = clampPoint(end, size)
  const width = Math.abs(last.x - first.x)
  const height = Math.abs(last.y - first.y)
  if (Math.max(width, height) <= clickTolerance) return null
  if (width < minimumSize || height < minimumSize) return null
  return {
    kind: 'region',
    region: {
      x: Math.min(first.x, last.x) / size.width,
      y: Math.min(first.y, last.y) / size.height,
      width: width / size.width,
      height: height / size.height,
    },
  }
}

export function sourceRect(region: NormalizedRect, size: { width: number; height: number }): Rect {
  if (size.width < 1 || size.height < 1) throw new RangeError('Capture source size must be positive')
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000_001 || region.y + region.height > 1.000_001) throw new RangeError('Normalized region is invalid')
  const x = Math.max(0, Math.min(size.width - 1, Math.round(region.x * size.width)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(region.y * size.height)))
  const right = Math.max(x + 1, Math.min(size.width, Math.round((region.x + region.width) * size.width)))
  const bottom = Math.max(y + 1, Math.min(size.height, Math.round((region.y + region.height) * size.height)))
  return { x, y, width: right - x, height: bottom - y }
}

export function matchWindowTargets(nativeWindows: NativeWindowMetadata[], captureSources: CaptureWindowMetadata[], ownProcessId: number, platform: NodeJS.Platform): WindowTarget[] {
  return nativeWindows.flatMap(window => {
    if (window.owner.processId === ownProcessId || window.bounds.width < 1 || window.bounds.height < 1) return []
    const source = matchCaptureWindowSource(window.id, captureSources, platform)
    return source ? [{ id: source.id, label: source.name || window.title || 'Untitled window', bounds: { ...window.bounds } }] : []
  })
}

export function matchCaptureWindowSource(nativeId: number, captureSources: CaptureWindowMetadata[], platform: NodeJS.Platform): CaptureWindowMetadata | null {
  return captureSources.find(source => {
    const parsed = parseCaptureWindowId(source.id)
    return parsed?.scope === '0' && nativeIdsMatch(nativeId, parsed.nativeId, platform)
  }) ?? null
}

export function win32WindowCaptureId(nativeId: number): string {
  if (!Number.isSafeInteger(nativeId)) throw new RangeError(`Invalid native window id: ${JSON.stringify(nativeId)}`)
  const token = BigInt.asUintN(32, BigInt(nativeId))
  if (token === 0n) throw new RangeError(`Invalid native window id: ${JSON.stringify(nativeId)}`)
  return `window:${token}:0`
}

export function windowAtPoint(targets: WindowTarget[], point: Point): WindowTarget | null {
  return targets.find(target => point.x >= target.bounds.x && point.y >= target.bounds.y && point.x < target.bounds.x + target.bounds.width && point.y < target.bounds.y + target.bounds.height) ?? null
}

export function windowsInSnapshotOrder(targets: WindowTarget[], snapshotOrder: string[]): WindowTarget[] {
  const remaining = new Map(targets.map(target => [target.id, target]))
  const ordered = snapshotOrder.flatMap(id => {
    const target = remaining.get(id)
    if (!target) return []
    remaining.delete(id)
    return [target]
  })
  return [...ordered, ...remaining.values()]
}

export function parseCaptureWindowId(sourceId: string): { nativeId: string; scope: '0' | '1' } | null {
  const match = /^window:([^:]+):([01])$/.exec(sourceId)
  return match ? { nativeId: match[1]!, scope: match[2] as '0' | '1' } : null
}

function nativeIdsMatch(id: number, token: string, platform: NodeJS.Platform): boolean {
  const parsed = parseNativeId(token)
  if (parsed === null || !Number.isInteger(id)) return false
  const native = BigInt(id)
  if (platform === 'win32') return parsed === BigInt.asIntN(32, native) || parsed === BigInt.asUintN(32, native)
  else if (platform === 'darwin' || platform === 'linux') return parsed === native
  else throw new Error(`Unsupported picker platform: ${JSON.stringify(platform)}`)
}

function parseNativeId(token: string): bigint | null {
  if (/^-?\d+$/.test(token) || /^0x[a-f\d]+$/i.test(token)) return BigInt(token)
  return null
}

function clampPoint(point: Point, size: { width: number; height: number }): Point {
  return { x: Math.max(0, Math.min(size.width, point.x)), y: Math.max(0, Math.min(size.height, point.y)) }
}
