import koffi, { type KoffiFunc } from 'koffi'
import { ScreenMcpError } from '../../../core/mcp/src/errors'
import type { ScreenPoint } from './coordinate-resolver'

const INPUT_SIZE = 40
const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1
const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const MOUSEEVENTF_ABSOLUTE = 0x8000
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const VK_RETURN = 0x0d
const GA_ROOT = 2

type NativeHandleValue = number | bigint | null

export interface VirtualDesktopBounds {
  x: number
  y: number
  width: number
  height: number
}

interface NativeInput {
  send(events: Buffer, count: number): number
  virtualBounds(): VirtualDesktopBounds
  foregroundHwnd(): number
  rootWindowFromPoint(point: ScreenPoint): number
}

export interface WinInputOptions {
  platform?: NodeJS.Platform
  native?: NativeInput
}

export class WinInput {
  private platform: NodeJS.Platform
  private native: NativeInput | null

  constructor(options: WinInputOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.native = options.native ?? null
  }

  click(point: ScreenPoint, options: { button?: 'left' | 'right'; double?: boolean } = {}): void {
    const native = this.requireNative()
    const absolute = toAbsolute(point, native.virtualBounds())
    const button = options.button ?? 'left'
    let down: number
    let up: number
    if (button === 'left') { down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP }
    else if (button === 'right') { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP }
    else throw new Error(`Unknown mouse button: ${JSON.stringify(button)}`)
    const events = [mouseEvent(absolute, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK), mouseEvent(absolute, down), mouseEvent(absolute, up)]
    if (options.double) events.push(mouseEvent(absolute, down), mouseEvent(absolute, up))
    this.inject(events)
  }

  typeText(text: string): void {
    const events: Buffer[] = []
    for (let index = 0; index < text.length; index++) {
      const codeUnit = text.charCodeAt(index)
      events.push(keyEvent(0, codeUnit, KEYEVENTF_UNICODE), keyEvent(0, codeUnit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))
    }
    this.inject(events)
  }

  pressEnter(): void {
    this.inject([keyEvent(VK_RETURN, 0, 0), keyEvent(VK_RETURN, 0, KEYEVENTF_KEYUP)])
  }

  foregroundHwnd(): number {
    return this.requireNative().foregroundHwnd()
  }

  rootWindowFromPoint(point: ScreenPoint): number {
    return this.requireNative().rootWindowFromPoint(point)
  }

  private inject(events: Buffer[]): void {
    if (!events.length) return
    const native = this.requireNative()
    for (let offset = 0; offset < events.length; offset += 256) {
      const batch = events.slice(offset, offset + 256)
      const buffer = Buffer.concat(batch)
      if (native.send(buffer, batch.length) !== batch.length) throw new ScreenMcpError('injection_failed', 'Windows rejected one or more input events')
    }
  }

  private requireNative(): NativeInput {
    if (this.platform !== 'win32') throw new ScreenMcpError('control_unavailable', 'Interactive control is available on Windows only')
    this.native ??= createNativeInput()
    return this.native
  }
}

export function toAbsolute(point: ScreenPoint, bounds: VirtualDesktopBounds): ScreenPoint {
  if (bounds.width < 1 || bounds.height < 1) throw new ScreenMcpError('control_unavailable', 'Windows returned invalid virtual desktop bounds')
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width - 1 || point.y > bounds.y + bounds.height - 1)
    throw new ScreenMcpError('out_of_bounds', 'Point is outside the virtual desktop; no click was sent')
  return {
    x: Math.round((point.x - bounds.x) * 65_535 / Math.max(1, bounds.width - 1)),
    y: Math.round((point.y - bounds.y) * 65_535 / Math.max(1, bounds.height - 1)),
  }
}

function createNativeInput(): NativeInput {
  try {
    const user32 = koffi.load('user32.dll')
    const POINT = koffi.struct({ x: 'int32', y: 'int32' })
    const SendInput = user32.func('uint32 SendInput(uint32, void*, int)')
    const GetSystemMetrics = user32.func('int GetSystemMetrics(int)')
    const GetForegroundWindow = user32.func('intptr GetForegroundWindow()')
    const WindowFromPoint = user32.func('WindowFromPoint', 'intptr', [POINT]) as KoffiFunc<(point: ScreenPoint) => NativeHandleValue>
    const GetAncestor = user32.func('intptr GetAncestor(intptr, uint)') as KoffiFunc<(handle: number | bigint, flags: number) => NativeHandleValue>
    const toHwnd = (handle: unknown): number => Number(BigInt.asUintN(32, BigInt(handle as number | bigint)))
    return {
      send: (events, count) => Number(SendInput(count, events, INPUT_SIZE)),
      virtualBounds: () => ({
        x: Number(GetSystemMetrics(76)),
        y: Number(GetSystemMetrics(77)),
        width: Number(GetSystemMetrics(78)),
        height: Number(GetSystemMetrics(79)),
      }),
      foregroundHwnd: () => toHwnd(GetForegroundWindow()),
      rootWindowFromPoint: point => {
        const child = WindowFromPoint({ x: point.x, y: point.y })
        if (!child) return 0
        const root = GetAncestor(child, GA_ROOT)
        return toHwnd(root || child)
      },
    }
  } catch (error) {
    throw new ScreenMcpError('control_unavailable', error instanceof Error ? error.message : String(error))
  }
}

function mouseEvent(point: ScreenPoint, flags: number): Buffer {
  const event = Buffer.alloc(INPUT_SIZE)
  event.writeUInt32LE(INPUT_MOUSE, 0)
  event.writeInt32LE(point.x, 8)
  event.writeInt32LE(point.y, 12)
  event.writeUInt32LE(flags, 20)
  return event
}

function keyEvent(virtualKey: number, scanCode: number, flags: number): Buffer {
  const event = Buffer.alloc(INPUT_SIZE)
  event.writeUInt32LE(INPUT_KEYBOARD, 0)
  event.writeUInt16LE(virtualKey, 8)
  event.writeUInt16LE(scanCode, 10)
  event.writeUInt32LE(flags, 12)
  return event
}
