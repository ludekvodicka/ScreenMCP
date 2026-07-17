import { describe, expect, it } from 'vitest'
import { activeModalWindowWin32, enumerateWindowsWin32, inspectNativeWindowWin32, type Win32WindowApi, type Win32WindowSnapshot } from './native-window-enum'

const WS_CAPTION = 0x00c00000
const WS_POPUP = 0x80000000
const WS_CHILD = 0x40000000
const WS_EX_TOOLWINDOW = 0x00000080
const WS_EX_APPWINDOW = 0x00040000

describe('native Windows window enumeration', () => {
  it('keeps a visible disabled application main window in native z-order', () => {
    const windows = enumerateWindowsWin32(fakeApi([
      [101n, snapshot({ title: 'Total Commander', enabled: false, processId: 10 })],
      [102n, snapshot({ title: 'Chrome', processId: 20 })],
    ]))
    expect(windows.map(window => window.title)).toEqual(['Total Commander', 'Chrome'])
  })

  it('retains the existing visibility and window-kind exclusions', () => {
    const windows = enumerateWindowsWin32(fakeApi([
      [1n, snapshot({ title: 'Normal' })],
      [2n, snapshot({ title: 'Hidden', visible: false })],
      [3n, snapshot({ title: 'Cloaked', cloaked: true })],
      [4n, snapshot({ title: 'Tool', exStyle: WS_EX_TOOLWINDOW })],
      [5n, snapshot({ title: 'Child', style: WS_CAPTION | WS_CHILD })],
      [6n, snapshot({ title: 'Untyped', style: 0 })],
      [7n, snapshot({ title: 'Owned dialog', style: WS_POPUP, owned: true })],
      [8n, snapshot({ title: 'Empty', bounds: { x: 0, y: 0, width: 0, height: 100 } })],
      [9n, snapshot({ title: 'Owned app', style: WS_POPUP, exStyle: WS_EX_APPWINDOW, owned: true })],
    ]))
    expect(windows.map(window => window.title)).toEqual(['Normal', 'Owned app'])
  })

  it('finds the enabled owned modal of a disabled same-process parent', () => {
    const api = fakeApi([
      [101n, snapshot({ title: 'Total Commander', enabled: false, processId: 10 })],
      [202n, snapshot({ title: 'Confirm replace', style: WS_POPUP, owned: true, processId: 10, bounds: { x: 900, y: 700, width: 600, height: 400 } })],
    ], new Map([[101n, 202n]]))

    expect(activeModalWindowWin32(101, api)).toEqual({
      id: 202,
      title: 'Confirm replace',
      owner: { processId: 10 },
      bounds: { x: 900, y: 700, width: 600, height: 400 },
    })
  })

  it('does not follow modeless, unrelated, hidden, or child popups', () => {
    const candidate = snapshot({ title: 'Dialog', style: WS_POPUP, owned: true, processId: 10 })
    expect(activeModalWindowWin32(101, fakeApi([[101n, snapshot({ enabled: true, processId: 10 })], [202n, candidate]], new Map([[101n, 202n]])))).toBeNull()
    expect(activeModalWindowWin32(101, fakeApi([[101n, snapshot({ enabled: false, processId: 10 })], [202n, { ...candidate, processId: 11 }]], new Map([[101n, 202n]])))).toBeNull()
    expect(activeModalWindowWin32(101, fakeApi([[101n, snapshot({ enabled: false, processId: 10 })], [202n, { ...candidate, visible: false }]], new Map([[101n, 202n]])))).toBeNull()
    expect(activeModalWindowWin32(101, fakeApi([[101n, snapshot({ enabled: false, processId: 10 })], [202n, { ...candidate, style: WS_POPUP | WS_CHILD }]], new Map([[101n, 202n]])))).toBeNull()
  })

  it('inspects an owned dialog directly without making it a picker target', () => {
    const api = fakeApi([[0x80000001n, snapshot({ title: 'Dialog', style: WS_POPUP, owned: true })]])
    expect(enumerateWindowsWin32(api)).toEqual([])
    expect(inspectNativeWindowWin32(0x80000001, api)?.id).toBe(-2_147_483_647)
  })
})

function snapshot(patch: Partial<Win32WindowSnapshot> = {}): Win32WindowSnapshot {
  return {
    title: 'Window',
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    processId: 1,
    visible: true,
    enabled: true,
    cloaked: false,
    style: WS_CAPTION,
    exStyle: 0,
    owned: false,
    ...patch,
  }
}

function fakeApi(entries: Array<[bigint, Win32WindowSnapshot | null]>, enabledPopups = new Map<bigint, bigint>()): Win32WindowApi {
  const snapshots = new Map(entries)
  const handles = entries.map(([handle]) => handle)
  return {
    first: () => handles[0] ?? 0n,
    next: handle => handles[handles.indexOf(handle) + 1] ?? 0n,
    enabledPopup: handle => enabledPopups.get(handle) ?? handle,
    inspect: handle => snapshots.get(handle) ?? null,
  }
}
