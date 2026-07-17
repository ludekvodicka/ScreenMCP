import koffi, { type KoffiFunc } from 'koffi'
import { openWindows } from 'get-windows'
import type { Rect } from '../shared/contracts'
import type { NativeWindowMetadata } from './source-picker-geometry'

const GW_OWNER = 4
const GW_HWNDNEXT = 2
const GW_ENABLEDPOPUP = 6
const GWL_STYLE = -16
const GWL_EXSTYLE = -20
const WS_CAPTION = 0x00c00000
const WS_POPUP = 0x80000000
const WS_CHILD = 0x40000000
const WS_EX_TOOLWINDOW = 0x00000080
const WS_EX_APPWINDOW = 0x00040000
const DWMWA_CLOAKED = 14

type NativeHandleValue = number | bigint | null

export interface Win32WindowSnapshot {
  title: string
  bounds: Rect
  processId: number
  visible: boolean
  enabled: boolean
  cloaked: boolean
  style: number
  exStyle: number
  owned: boolean
}

export interface Win32WindowApi {
  first(): bigint
  next(handle: bigint): bigint
  enabledPopup(handle: bigint): bigint
  inspect(handle: bigint): Win32WindowSnapshot | null
}

export async function openNativeWindows(platform: NodeJS.Platform = process.platform): Promise<NativeWindowMetadata[]> {
  if (platform === 'win32') return enumerateWindowsWin32()
  else if (platform === 'darwin' || platform === 'linux') return (await openWindows({ accessibilityPermission: false, screenRecordingPermission: false })).map(window => ({
    id: window.id,
    title: window.title,
    owner: { processId: window.owner.processId },
    bounds: { ...window.bounds },
  }))
  else throw new Error(`Unsupported window enumeration platform: ${JSON.stringify(platform)}`)
}

export function enumerateWindowsWin32(api: Win32WindowApi = createWin32WindowApi()): NativeWindowMetadata[] {
  const windows: NativeWindowMetadata[] = []
  const visited = new Set<bigint>()
  for (let handle = api.first(); handle !== 0n && !visited.has(handle); handle = api.next(handle)) {
    visited.add(handle)
    const window = api.inspect(handle)
    if (!window || !isPickerWindow(window)) continue
    windows.push({
      id: Number(BigInt.asIntN(32, handle)),
      title: window.title,
      owner: { processId: window.processId },
      bounds: { ...window.bounds },
    })
  }
  return windows
}

export function activeModalWindowWin32(rootId: number, api: Win32WindowApi = createWin32WindowApi()): NativeWindowMetadata | null {
  const rootHandle = win32Handle(rootId)
  const root = api.inspect(rootHandle)
  if (!root || root.enabled) return null
  const popupHandle = api.enabledPopup(rootHandle)
  if (popupHandle === 0n || popupHandle === rootHandle) return null
  const popup = api.inspect(popupHandle)
  if (!popup || !popup.owned || popup.processId !== root.processId || !popup.enabled || !isUsableWindow(popup) || (popup.style & WS_CHILD) !== 0) return null
  return toMetadata(popupHandle, popup)
}

export function inspectNativeWindowWin32(id: number, api: Win32WindowApi = createWin32WindowApi()): NativeWindowMetadata | null {
  const handle = win32Handle(id)
  const window = api.inspect(handle)
  return window && isUsableWindow(window) ? toMetadata(handle, window) : null
}

function isPickerWindow(window: Win32WindowSnapshot): boolean {
  if (!isUsableWindow(window)) return false
  if ((window.exStyle & WS_EX_TOOLWINDOW) !== 0 || (window.style & WS_CHILD) !== 0) return false
  if ((window.style & WS_CAPTION) !== WS_CAPTION && (window.style & WS_POPUP) === 0) return false
  if (window.owned && (window.exStyle & WS_EX_APPWINDOW) === 0) return false
  // A modal can disable its visible capturable main HWND; enabled state is intentionally not filtered.
  return true
}

function isUsableWindow(window: Win32WindowSnapshot): boolean {
  return window.visible && !window.cloaked && window.bounds.width > 0 && window.bounds.height > 0
}

function toMetadata(handle: bigint, window: Win32WindowSnapshot): NativeWindowMetadata {
  return {
    id: Number(BigInt.asIntN(32, handle)),
    title: window.title,
    owner: { processId: window.processId },
    bounds: { ...window.bounds },
  }
}

function createWin32WindowApi(): Win32WindowApi {
  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')
  const GetTopWindow = user32.func('intptr GetTopWindow(intptr)') as KoffiFunc<(parent: bigint) => NativeHandleValue>
  const GetWindow = user32.func('intptr GetWindow(intptr, uint32)') as KoffiFunc<(handle: bigint, command: number) => NativeHandleValue>
  const IsWindow = user32.func('bool IsWindow(intptr)') as KoffiFunc<(handle: bigint) => boolean>
  const IsWindowVisible = user32.func('bool IsWindowVisible(intptr)') as KoffiFunc<(handle: bigint) => boolean>
  const IsWindowEnabled = user32.func('bool IsWindowEnabled(intptr)') as KoffiFunc<(handle: bigint) => boolean>
  const GetWindowLongPtrW = user32.func('intptr GetWindowLongPtrW(intptr, int)') as KoffiFunc<(handle: bigint, index: number) => NativeHandleValue>
  const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr, void*)') as KoffiFunc<(handle: bigint, processId: Buffer) => number>
  const GetWindowRect = user32.func('bool GetWindowRect(intptr, void*)') as KoffiFunc<(handle: bigint, rect: Buffer) => boolean>
  const GetWindowTextLengthW = user32.func('int GetWindowTextLengthW(intptr)') as KoffiFunc<(handle: bigint) => number>
  const GetWindowTextW = user32.func('int GetWindowTextW(intptr, void*, int)') as KoffiFunc<(handle: bigint, text: Buffer, length: number) => number>
  const DwmGetWindowAttribute = dwmapi.func('int DwmGetWindowAttribute(intptr, uint32, void*, uint32)') as KoffiFunc<(handle: bigint, attribute: number, value: Buffer, size: number) => number>
  return {
    first: () => toHandle(GetTopWindow(0n)),
    next: handle => toHandle(GetWindow(handle, GW_HWNDNEXT)),
    enabledPopup: handle => toHandle(GetWindow(handle, GW_ENABLEDPOPUP)),
    inspect: handle => {
      if (!IsWindow(handle)) return null
      const rect = Buffer.alloc(16)
      if (!GetWindowRect(handle, rect)) return null
      const processId = Buffer.alloc(4)
      GetWindowThreadProcessId(handle, processId)
      const cloaked = Buffer.alloc(4)
      const cloakedResult = DwmGetWindowAttribute(handle, DWMWA_CLOAKED, cloaked, cloaked.length)
      return {
        title: windowTitle(handle, GetWindowTextLengthW, GetWindowTextW),
        bounds: {
          x: rect.readInt32LE(0),
          y: rect.readInt32LE(4),
          width: rect.readInt32LE(8) - rect.readInt32LE(0),
          height: rect.readInt32LE(12) - rect.readInt32LE(4),
        },
        processId: processId.readUInt32LE(),
        visible: IsWindowVisible(handle),
        enabled: IsWindowEnabled(handle),
        cloaked: cloakedResult === 0 && cloaked.readUInt32LE() !== 0,
        style: toUint32(GetWindowLongPtrW(handle, GWL_STYLE)),
        exStyle: toUint32(GetWindowLongPtrW(handle, GWL_EXSTYLE)),
        owned: toHandle(GetWindow(handle, GW_OWNER)) !== 0n,
      }
    },
  }
}

function windowTitle(
  handle: bigint,
  lengthOf: (handle: bigint) => number,
  read: (handle: bigint, text: Buffer, length: number) => number,
): string {
  const length = Math.max(0, lengthOf(handle))
  const text = Buffer.alloc((length + 1) * 2)
  const copied = Math.max(0, read(handle, text, length + 1))
  return text.subarray(0, copied * 2).toString('utf16le')
}

function toHandle(value: NativeHandleValue): bigint {
  return value === null ? 0n : BigInt(value)
}

function toUint32(value: NativeHandleValue): number {
  return Number(BigInt.asUintN(32, toHandle(value)))
}

function win32Handle(id: number): bigint {
  if (!Number.isInteger(id)) throw new TypeError('Window handle must be an integer')
  return BigInt.asUintN(32, BigInt(id))
}
