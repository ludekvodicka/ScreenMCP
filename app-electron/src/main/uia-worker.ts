import { parentPort } from 'node:worker_threads'
import koffi, { type TypeObject } from 'koffi'
import { ScreenMcpError, asScreenMcpError } from '../../../core/mcp/src/errors'
import type { RawElement, UiaWorkerRequest, UiaWorkerResponse } from './uia-client'

const PTR = 8
const MAX_ELEMENTS = 500
const MAX_DEPTH = 32
const UIA_INVOKE_PATTERN_ID = 10_000
const UIA_VALUE_PATTERN_ID = 10_002

const CLSID_CUIAutomation = guid('{FF48DBA4-60EF-4201-AA87-54103EEF594E}')
const IID_IUIAutomation = guid('{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}')
const IID_IUIAutomationInvokePattern = guid('{fb377fbe-8ea6-46d5-9c73-6499642d3059}')
const IID_IUIAutomationValuePattern = guid('{a94cd8b1-0844-4cd6-9d2d-640537ab39e9}')

const ole32 = koffi.load('ole32.dll')
const oleaut32 = koffi.load('oleaut32.dll')
const CoInitializeEx = ole32.func('int CoInitializeEx(void*, uint32)')
const CoCreateInstance = ole32.func('int CoCreateInstance(void*, void*, uint32, void*, void*)')
const CoUninitialize = ole32.func('void CoUninitialize()')
const SysAllocString = oleaut32.func('void* SysAllocString(str16)')
const SysFreeString = oleaut32.func('void SysFreeString(void*)')
const SafeArrayGetDim = oleaut32.func('uint32 SafeArrayGetDim(void*)')
const SafeArrayGetLBound = oleaut32.func('int SafeArrayGetLBound(void*, uint32, void*)')
const SafeArrayGetUBound = oleaut32.func('int SafeArrayGetUBound(void*, uint32, void*)')
const SafeArrayAccessData = oleaut32.func('int SafeArrayAccessData(void*, void*)')
const SafeArrayUnaccessData = oleaut32.func('int SafeArrayUnaccessData(void*)')
const SafeArrayDestroy = oleaut32.func('int SafeArrayDestroy(void*)')

const P_Release = koffi.proto('uint32 Release(void* self)')
const P_ElementFromHandle = koffi.proto('int ElementFromHandle(void* self, intptr hwnd, void* out)')
const P_InterfaceOut = koffi.proto('int InterfaceOut(void* self, void* out)')
const P_WalkerElementOut = koffi.proto('int WalkerElementOut(void* self, void* element, void* out)')
const P_GetRuntimeId = koffi.proto('int GetRuntimeId(void* self, void* out)')
const P_GetCurrentPatternAs = koffi.proto('int GetCurrentPatternAs(void* self, int patternId, void* iid, void* out)')
const P_GetInt = koffi.proto('int GetInt(void* self, void* out)')
const P_GetBstr = koffi.proto('int GetBstr(void* self, void* out)')
const P_GetRect = koffi.proto('int GetRect(void* self, void* out)')
const P_NoArgs = koffi.proto('int NoArgs(void* self)')
const P_SetValue = koffi.proto('int SetValue(void* self, void* value)')

interface OwnedElement {
  pointer: unknown
  raw: RawElement
}

let automation: unknown = null
let initialized = false
let cacheHwnd: number | null = null
let cacheGeneration = 0
const cache = new Map<string, OwnedElement>()

const port = parentPort
if (!port) throw new Error('UI Automation worker requires a parent port')

port.on('message', (message: unknown) => {
  if (!isRequest(message)) return
  let response: UiaWorkerResponse
  try {
    const result = dispatch(message)
    response = { requestId: message.requestId, ok: true, result }
  } catch (error) {
    const known = asScreenMcpError(error)
    response = { requestId: message.requestId, ok: false, error: { code: known.code, message: known.message } }
  }
  port.postMessage(response)
  if (message.action === 'dispose') port.close()
})

process.once('exit', shutdown)

function dispatch(request: UiaWorkerRequest): unknown {
  if (request.action === 'enumerate') return enumerate(request.hwnd)
  else if (request.action === 'snapshot') return snapshotEntry(request.hwnd, request.ref)
  else if (request.action === 'invoke') { invoke(request.hwnd, request.ref, request.scope); return undefined }
  else if (request.action === 'getValue') return getValue(request.hwnd, request.ref, request.scope)
  else if (request.action === 'setValue') { setValue(request.hwnd, request.ref, request.text, request.scope); return undefined }
  else if (request.action === 'focus') { focus(request.hwnd, request.ref, request.scope); return undefined }
  else if (request.action === 'clear') { clearCache(); return undefined }
  else if (request.action === 'dispose') { shutdown(); return undefined }
  else throw new Error(`Unknown UI Automation action: ${JSON.stringify(request)}`)
}

function snapshotEntry(hwnd: number, ref: string): RawElement | null {
  if (cacheHwnd !== hwnd) return null
  const entry = cache.get(ref)
  return entry ? cloneRaw(entry.raw) : null
}

function ensureInitialized(): void {
  if (initialized) return
  try {
    checkHresult(Number(CoInitializeEx(null, 0)), 'CoInitializeEx', 'control_unavailable')
    initialized = true
    const out = Buffer.alloc(PTR)
    checkHresult(Number(CoCreateInstance(CLSID_CUIAutomation, null, 1, IID_IUIAutomation, out)), 'CoCreateInstance(CUIAutomation)', 'control_unavailable')
    automation = decodePointer(out)
    if (automation === null) throw new ScreenMcpError('control_unavailable', 'UI Automation returned a null interface')
  } catch (error) {
    if (initialized) CoUninitialize()
    initialized = false
    automation = null
    if (error instanceof ScreenMcpError) throw error
    throw new ScreenMcpError('control_unavailable', error instanceof Error ? error.message : String(error))
  }
}

function enumerate(hwnd: number): { elements: RawElement[]; truncated: boolean } {
  ensureInitialized()
  clearCache()
  const found = walk(hwnd)
  cacheHwnd = hwnd
  cacheGeneration++
  let index = 0
  for (const entry of found) {
    entry.raw.ref = `s${cacheGeneration}e${++index}`
    cache.set(entry.raw.ref, entry)
  }
  return {
    elements: found.map(entry => cloneRaw(entry.raw)),
    truncated: found.length >= MAX_ELEMENTS,
  }
}

function resolveEntry(hwnd: number, ref: string): OwnedElement | null {
  ensureInitialized()
  const previous = cacheHwnd === hwnd ? cache.get(ref) : undefined
  if (!previous) return null
  const candidates = walk(hwnd)
  let matchIndex = previous.raw.runtimeId.length
    ? candidates.findIndex(candidate => arraysEqual(candidate.raw.runtimeId, previous.raw.runtimeId))
    : -1
  if (matchIndex < 0) matchIndex = nearestMatch(candidates, previous.raw)
  if (matchIndex < 0) {
    releaseAll(candidates)
    return null
  }
  const matched = candidates[matchIndex]!
  matched.raw.ref = ref
  release(previous.pointer)
  cache.set(ref, matched)
  for (let index = 0; index < candidates.length; index++) if (index !== matchIndex) release(candidates[index]!.pointer)
  return matched
}

function invoke(hwnd: number, ref: string, scope?: RawElement['bounds']): void {
  const entry = requireElement(hwnd, ref, scope)
  const pattern = patternPointer(entry.pointer, UIA_INVOKE_PATTERN_ID, IID_IUIAutomationInvokePattern, 'not_invokable')
  try { checkHresult(method(pattern, 3, P_NoArgs)(pattern), 'InvokePattern.Invoke', 'not_invokable') }
  finally { release(pattern) }
}

function getValue(hwnd: number, ref: string, scope?: RawElement['bounds']): string {
  const entry = requireElement(hwnd, ref, scope)
  return readValue(entry.pointer) ?? entry.raw.name
}

function setValue(hwnd: number, ref: string, text: string, scope?: RawElement['bounds']): void {
  const entry = requireElement(hwnd, ref, scope)
  const pattern = patternPointer(entry.pointer, UIA_VALUE_PATTERN_ID, IID_IUIAutomationValuePattern, 'not_editable')
  try {
    const readOnly = Buffer.alloc(4)
    checkHresult(method(pattern, 5, P_GetInt)(pattern, readOnly), 'ValuePattern.CurrentIsReadOnly', 'not_editable')
    if (readOnly.readInt32LE(0) !== 0) throw new ScreenMcpError('not_editable', 'The selected element is read-only')
    const value: unknown = SysAllocString(text)
    if (!value) throw new ScreenMcpError('text_rejected', 'Windows could not allocate the text value')
    try { checkHresult(method(pattern, 3, P_SetValue)(pattern, value), 'ValuePattern.SetValue', 'text_rejected') }
    finally { SysFreeString(value) }
  } finally { release(pattern) }
}

function focus(hwnd: number, ref: string, scope?: RawElement['bounds']): void {
  const entry = requireElement(hwnd, ref, scope)
  checkHresult(method(entry.pointer, 3, P_NoArgs)(entry.pointer), 'IUIAutomationElement.SetFocus', 'element_stale')
}

function requireElement(hwnd: number, ref: string, scope?: RawElement['bounds']): OwnedElement {
  const entry = resolveEntry(hwnd, ref)
  if (!entry) throw new ScreenMcpError('element_stale', 'The element moved or vanished; call list_elements again')
  if (scope && !contains(scope, entry.raw.bounds)) throw new ScreenMcpError('out_of_bounds', 'The element moved outside the selected source')
  return entry
}

function walk(hwnd: number): OwnedElement[] {
  if (automation === null) throw new ScreenMcpError('control_unavailable', 'UI Automation is not initialized')
  const rootOut = Buffer.alloc(PTR)
  checkHresult(method(automation, 6, P_ElementFromHandle)(automation, hwnd, rootOut), 'IUIAutomation.ElementFromHandle', 'control_unavailable')
  const root = decodePointer(rootOut)
  if (root === null) throw new ScreenMcpError('control_unavailable', 'The selected window is unavailable to UI Automation')
  const walkerOut = Buffer.alloc(PTR)
  try { checkHresult(method(automation, 14, P_InterfaceOut)(automation, walkerOut), 'IUIAutomation.ControlViewWalker', 'control_unavailable') }
  catch (error) { release(root); throw error }
  const walker = decodePointer(walkerOut)
  if (walker === null) { release(root); throw new ScreenMcpError('control_unavailable', 'UI Automation returned no control walker') }
  const elements: OwnedElement[] = []
  const collect = (pointer: unknown, depth: number): void => {
    let raw: RawElement
    try { raw = readElement(pointer) }
    catch { release(pointer); return }
    elements.push({ pointer, raw })
    if (depth >= MAX_DEPTH || elements.length >= MAX_ELEMENTS) return
    let current = optionalElement(method(walker, 4, P_WalkerElementOut), walker, pointer)
    while (current !== null && elements.length < MAX_ELEMENTS) {
      const next = optionalElement(method(walker, 6, P_WalkerElementOut), walker, current)
      collect(current, depth + 1)
      if (elements.length >= MAX_ELEMENTS && next !== null) release(next)
      current = elements.length >= MAX_ELEMENTS ? null : next
    }
  }
  try { collect(root, 0); return elements }
  catch (error) { releaseAll(elements); throw error }
  finally { release(walker) }
}

function readElement(pointer: unknown): RawElement {
  const controlType = readInt(pointer, 21, 'CurrentControlType')
  const name = readBstr(pointer, 23, 'CurrentName')
  const enabled = readInt(pointer, 28, 'CurrentIsEnabled') !== 0
  const rect = Buffer.alloc(16)
  checkHresult(method(pointer, 43, P_GetRect)(pointer, rect), 'CurrentBoundingRectangle', 'element_stale')
  const left = rect.readInt32LE(0)
  const top = rect.readInt32LE(4)
  const right = rect.readInt32LE(8)
  const bottom = rect.readInt32LE(12)
  const value = readValue(pointer)
  return {
    ref: '',
    runtimeId: readRuntimeId(pointer),
    controlType,
    role: roleName(controlType),
    name,
    ...(value === undefined ? {} : { value }),
    enabled,
    bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
  }
}

function readRuntimeId(pointer: unknown): number[] {
  const out = Buffer.alloc(PTR)
  const hr = method(pointer, 4, P_GetRuntimeId)(pointer, out)
  if (hr < 0) return []
  const array = decodePointer(out)
  if (array === null) return []
  try {
    if (SafeArrayGetDim(array) !== 1) return []
    const lower = Buffer.alloc(4)
    const upper = Buffer.alloc(4)
    if (SafeArrayGetLBound(array, 1, lower) < 0 || SafeArrayGetUBound(array, 1, upper) < 0) return []
    const count = upper.readInt32LE(0) - lower.readInt32LE(0) + 1
    if (count < 1 || count > 128) return []
    const dataOut = Buffer.alloc(PTR)
    if (SafeArrayAccessData(array, dataOut) < 0) return []
    const data = decodePointer(dataOut)
    if (data === null) { SafeArrayUnaccessData(array); return [] }
    try {
      const buffer = Buffer.from(koffi.view(data, count * 4))
      return Array.from({ length: count }, (_, index) => buffer.readInt32LE(index * 4))
    } finally { SafeArrayUnaccessData(array) }
  } finally { SafeArrayDestroy(array) }
}

function readValue(pointer: unknown): string | undefined {
  const out = Buffer.alloc(PTR)
  const hr = method(pointer, 14, P_GetCurrentPatternAs)(pointer, UIA_VALUE_PATTERN_ID, IID_IUIAutomationValuePattern, out)
  if (hr < 0) return undefined
  const pattern = decodePointer(out)
  if (pattern === null) return undefined
  try { return readBstr(pattern, 4, 'ValuePattern.CurrentValue') }
  catch { return undefined }
  finally { release(pattern) }
}

function patternPointer(pointer: unknown, patternId: number, iid: Buffer, code: 'not_invokable' | 'not_editable'): unknown {
  const out = Buffer.alloc(PTR)
  const hr = method(pointer, 14, P_GetCurrentPatternAs)(pointer, patternId, iid, out)
  if (hr < 0) throw hresultError(code, `The selected element does not support ${code === 'not_invokable' ? 'Invoke' : 'Value'}Pattern`, hr)
  const pattern = decodePointer(out)
  if (pattern === null) throw new ScreenMcpError(code, `The selected element does not support ${code === 'not_invokable' ? 'Invoke' : 'Value'}Pattern`)
  return pattern
}

function optionalElement(call: (...args: unknown[]) => number, walker: unknown, element: unknown): unknown {
  const out = Buffer.alloc(PTR)
  if (call(walker, element, out) < 0) return null
  return decodePointer(out)
}

function readInt(pointer: unknown, index: number, label: string): number {
  const out = Buffer.alloc(4)
  checkHresult(method(pointer, index, P_GetInt)(pointer, out), label, 'element_stale')
  return out.readInt32LE(0)
}

function readBstr(pointer: unknown, index: number, label: string): string {
  const out = Buffer.alloc(PTR)
  checkHresult(method(pointer, index, P_GetBstr)(pointer, out), label, 'element_stale')
  const value = decodePointer(out)
  if (value === null) return ''
  try { return koffi.decode.string16(value) }
  finally { SysFreeString(value) }
}

function nearestMatch(candidates: OwnedElement[], previous: RawElement): number {
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!.raw
    if (candidate.controlType !== previous.controlType || candidate.name !== previous.name) continue
    const distance = centerDistance(candidate.bounds, previous.bounds)
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index }
  }
  return bestDistance <= 250 ? bestIndex : -1
}

function centerDistance(first: RawElement['bounds'], second: RawElement['bounds']): number {
  return Math.hypot(first.x + first.width / 2 - second.x - second.width / 2, first.y + first.height / 2 - second.y - second.height / 2)
}

function contains(outer: RawElement['bounds'], inner: RawElement['bounds']): boolean {
  const tolerance = 1
  return inner.width > 0 && inner.height > 0 && inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance
}

function method(iface: unknown, index: number, prototype: TypeObject): (...args: unknown[]) => number {
  const vtable: unknown = koffi.decode(iface, 'void*')
  const pointer: unknown = koffi.decode(vtable, index * PTR, 'void*')
  return koffi.decode(pointer, prototype) as (...args: unknown[]) => number
}

function decodePointer(buffer: Buffer): unknown {
  const pointer: unknown = koffi.decode(buffer, 'void*')
  return pointer || null
}

function release(pointer: unknown): void {
  if (pointer) method(pointer, 2, P_Release)(pointer)
}

function clearCache(): void {
  for (const entry of cache.values()) release(entry.pointer)
  cache.clear()
  cacheHwnd = null
}

function releaseAll(entries: OwnedElement[]): void {
  for (const entry of entries) release(entry.pointer)
}

function shutdown(): void {
  clearCache()
  if (automation !== null) release(automation)
  automation = null
  if (initialized) CoUninitialize()
  initialized = false
}

function checkHresult(hr: number, operation: string, code: 'control_unavailable' | 'element_stale' | 'not_invokable' | 'not_editable' | 'text_rejected'): void {
  if (hr < 0) throw hresultError(code, `${operation} failed`, hr)
}

function hresultError(code: 'control_unavailable' | 'element_stale' | 'not_invokable' | 'not_editable' | 'text_rejected', message: string, hr: number): ScreenMcpError {
  return new ScreenMcpError(code, `${message} (HRESULT 0x${(hr >>> 0).toString(16).padStart(8, '0')})`)
}

function arraysEqual(first: number[], second: number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function cloneRaw(element: RawElement): RawElement {
  return { ...element, runtimeId: [...element.runtimeId], bounds: { ...element.bounds } }
}

function roleName(controlType: number): string {
  return CONTROL_TYPES.get(controlType) ?? `control-${controlType}`
}

function guid(value: string): Buffer {
  const parts = value.replace(/[{}]/g, '').split('-')
  if (parts.length !== 5) throw new Error(`Invalid GUID: ${value}`)
  const output = Buffer.alloc(16)
  output.writeUInt32LE(Number.parseInt(parts[0]!, 16), 0)
  output.writeUInt16LE(Number.parseInt(parts[1]!, 16), 4)
  output.writeUInt16LE(Number.parseInt(parts[2]!, 16), 6)
  Buffer.from(`${parts[3]}${parts[4]}`, 'hex').copy(output, 8)
  return output
}

function isRequest(value: unknown): value is UiaWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<UiaWorkerRequest>
  return typeof request.requestId === 'string' && typeof request.action === 'string'
}

const CONTROL_TYPES = new Map<number, string>([
  [50_000, 'button'], [50_001, 'calendar'], [50_002, 'checkbox'], [50_003, 'combobox'], [50_004, 'edit'],
  [50_005, 'hyperlink'], [50_006, 'image'], [50_007, 'listitem'], [50_008, 'list'], [50_009, 'menu'],
  [50_010, 'menubar'], [50_011, 'menuitem'], [50_012, 'progressbar'], [50_013, 'radiobutton'], [50_014, 'scrollbar'],
  [50_015, 'slider'], [50_016, 'spinner'], [50_017, 'statusbar'], [50_018, 'tab'], [50_019, 'tabitem'],
  [50_020, 'text'], [50_021, 'toolbar'], [50_022, 'tooltip'], [50_023, 'tree'], [50_024, 'treeitem'],
  [50_025, 'custom'], [50_026, 'group'], [50_027, 'thumb'], [50_028, 'datagrid'], [50_029, 'dataitem'],
  [50_030, 'document'], [50_031, 'splitbutton'], [50_032, 'window'], [50_033, 'pane'], [50_034, 'header'],
  [50_035, 'headeritem'], [50_036, 'table'], [50_037, 'titlebar'], [50_038, 'separator'], [50_039, 'semanticzoom'],
  [50_040, 'appbar'],
])
