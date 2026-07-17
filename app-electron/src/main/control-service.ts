import type { ActionResult, ClickTarget, ElementFilter, ElementInfo, ListElementsResult, ReadTarget, ReadTextResult } from '../../../core/mcp/src/control'
import { ScreenMcpError, asScreenMcpError } from '../../../core/mcp/src/errors'
import type { ScreenControlService } from '../../../core/mcp/src/control'
import type { AuditEntry, ControlState, InteractiveWriteAction, SourceSelection } from '../shared/contracts'
import type { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController } from './capture-controller'
import type { ElectronCaptureService } from './capture-service'
import { captureHwnd, type CoordinateResolver, type ScreenPoint } from './coordinate-resolver'
import type { InteractiveRequestGate } from './interactive-request-service'
import type { OcrReader } from './ocr'
import { sourceKey } from './settings-store'
import { publish } from './streams'
import type { UiaClient } from './uia-client'
import type { WinInput } from './win-input'

export type DisarmReason = 'manual' | 'source' | 'stop' | 'quit'

export interface ControlServiceOptions {
  platform?: NodeJS.Platform
  interactiveRequests?: InteractiveRequestGate
}

export class ElectronControlService implements ScreenControlService {
  private armed: string | null = null
  private platform: NodeJS.Platform
  private interactiveRequests: InteractiveRequestGate | null
  private unsubscribeCapture: () => void
  private unsubscribeState: () => void
  private listeners = new Set<(state: ControlState) => void>()

  constructor(
    private capture: CaptureController,
    private captureService: ElectronCaptureService,
    private appState: AppState,
    private audit: AuditLog,
    private uia: UiaClient,
    private input: WinInput,
    private ocr: OcrReader,
    private coordinates: CoordinateResolver,
    options: ControlServiceOptions = {},
  ) {
    this.platform = options.platform ?? process.platform
    this.interactiveRequests = options.interactiveRequests ?? null
    this.unsubscribeCapture = capture.subscribe(() => this.disarm('source'))
    this.unsubscribeState = appState.subscribe(snapshot => { if (snapshot.stopped) this.disarm('stop') })
  }

  getState(): ControlState {
    return { armed: this.armed !== null, sourceKey: this.armed }
  }

  subscribe(listener: (state: ControlState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  arm(): void {
    this.assertWindows()
    if (this.appState.isStopped()) throw stoppedError()
    const selection = this.requireSelection()
    this.setArmed(sourceKey(selection))
  }

  disarm(_reason: DisarmReason): void {
    if (!this.armed) return
    this.armed = null
    void this.uia.clear().catch(() => undefined)
    this.publishState()
  }

  async listElements(client: string, filter: ElementFilter = {}): Promise<ListElementsResult> {
    const selection = await this.refreshArmedSelection()
    const target = filter.role || filter.name_contains ? JSON.stringify(filter) : 'all elements'
    try {
      if (selection.kind === 'monitor' || selection.kind === 'region') throw elementActionsUnavailable()
      else if (selection.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
      const result = await this.uia.enumerate(captureHwnd(selection))
      this.assertSameArmedSource(selection)
      const sourceBounds = await this.coordinates.sourceScreenBounds(selection)
      const elements: ElementInfo[] = []
      for (const raw of result.elements) {
        if (!matchesFilter(raw.role, raw.name, filter)) continue
        const bounds = await this.coordinates.toPayload(selection, raw.bounds, sourceBounds)
        if (!bounds) continue
        elements.push({ ref: raw.ref, role: raw.role, name: raw.name, ...(raw.value === undefined ? {} : { value: raw.value }), enabled: raw.enabled, bounds })
      }
      await this.appendAudit(client, 'enumerate', selection, target, 'uia', 'ok', null)
      return { elements, truncated: result.truncated, source: { kind: selection.kind, label: selection.label } }
    } catch (error) {
      await this.appendFailure(client, 'enumerate', selection, target, 'uia', error)
      throw error
    }
  }

  async readText(client: string, target: ReadTarget): Promise<ReadTextResult> {
    const selection = await this.refreshArmedSelection()
    let auditTarget = 'unknown'
    let method: AuditEntry['method'] = null
    try {
      if ('element_ref' in target) {
        auditTarget = target.element_ref
        method = 'uia'
        if (selection.kind === 'monitor' || selection.kind === 'region') throw elementActionsUnavailable()
        else if (selection.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
        const element = await this.resolveElement(selection, target.element_ref)
        await this.coordinates.assertWithinSource(selection, element.bounds)
        const scope = await this.coordinates.sourceScreenBounds(selection)
        const text = await this.uia.getValue(captureHwnd(selection), target.element_ref, scope)
        this.assertSameArmedSource(selection)
        auditTarget = element.name || target.element_ref
        const result = { text, method: 'uia' as const }
        await this.appendAudit(client, 'read', selection, auditTarget, method, 'ok', null)
        return result
      } else if ('region' in target) {
        auditTarget = rectLabel(target.region)
        method = 'ocr'
        this.coordinates.assertPayloadRect(selection, target.region)
        const frame = await this.captureService.controlFrame()
        this.assertSameArmedSource(selection)
        const result = await this.ocr.readRegion(frame, target.region)
        this.assertSameArmedSource(selection)
        await this.appendAudit(client, 'read', selection, auditTarget, method, 'ok', null)
        return result
      } else throw new Error(`Unknown read target: ${JSON.stringify(target)}`)
    } catch (error) {
      await this.appendFailure(client, 'read', selection, auditTarget, method, error)
      throw error
    }
  }

  async click(client: string, target: ClickTarget, options: { button?: 'left' | 'right'; double?: boolean } = {}, signal?: AbortSignal): Promise<ActionResult> {
    let selection: SourceSelection | null = null
    let auditTarget = 'unknown'
    let actionMethod: AuditEntry['method'] = null
    try {
      selection = await this.refreshWriteSelection()
      if ('element_ref' in target) {
        auditTarget = target.element_ref
        actionMethod = 'uia'
        if (selection.kind === 'monitor' || selection.kind === 'region') throw elementActionsUnavailable()
        else if (selection.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
        selection = await this.requireWriteAccess(client, 'click', selection, signal)
        const element = await this.resolveElement(selection, target.element_ref)
        await this.coordinates.assertWithinSource(selection, element.bounds)
        const scope = await this.coordinates.sourceScreenBounds(selection)
        auditTarget = element.name || target.element_ref
        this.assertNotStopped()
        this.assertRequestActive(signal)
        await this.uia.invoke(captureHwnd(selection), target.element_ref, scope)
        this.assertSameArmedSource(selection)
        await this.appendAudit(client, 'click', selection, auditTarget, actionMethod, 'ok', null)
        return { ok: true, method: 'uia' }
      } else if ('x' in target && 'y' in target) {
        auditTarget = `${target.x},${target.y}`
        actionMethod = 'coord'
        selection = await this.requireWriteAccess(client, 'click', selection, signal)
        const point = await this.coordinates.toScreen(selection, target)
        this.assertSameArmedSource(selection)
        if (selection.kind === 'window') this.assertHitTarget(selection, point)
        this.assertNotStopped()
        this.assertRequestActive(signal)
        this.input.click(point, options)
        this.assertSameArmedSource(selection)
        await this.appendAudit(client, 'click', selection, auditTarget, actionMethod, 'ok', null)
        return { ok: true, method: 'coord' }
      } else throw new Error(`Unknown click target: ${JSON.stringify(target)}`)
    } catch (error) {
      if (selection) await this.appendFailure(client, 'click', selection, auditTarget, actionMethod, error)
      throw error
    }
  }

  async typeText(client: string, text: string, options: { element_ref?: string; append?: boolean; submit?: boolean } = {}, signal?: AbortSignal): Promise<ActionResult> {
    let selection: SourceSelection | null = null
    let auditTarget = `${options.element_ref ?? 'focused element'} · [redacted ${text.length} chars]`
    const actionMethod: AuditEntry['method'] = options.append || !options.element_ref ? 'coord' : 'uia'
    try {
      selection = await this.refreshWriteSelection()
      validateText(text, options.submit === true)
      if (selection.kind === 'monitor' || selection.kind === 'region') throw elementActionsUnavailable()
      else if (selection.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
      selection = await this.requireWriteAccess(client, 'type_text', selection, signal)
      const hwnd = captureHwnd(selection)
      if (options.element_ref) {
        const element = await this.resolveElement(selection, options.element_ref)
        await this.coordinates.assertWithinSource(selection, element.bounds)
        const scope = await this.coordinates.sourceScreenBounds(selection)
        auditTarget = `${element.name || options.element_ref} · [redacted ${text.length} chars]`
        if (options.append) {
          this.assertNotStopped()
          this.assertRequestActive(signal)
          await this.uia.focus(hwnd, options.element_ref, scope)
          this.assertSameArmedSource(selection)
          this.assertNotStopped()
          this.assertForeground(hwnd)
          this.assertRequestActive(signal)
          this.input.typeText(text)
          this.assertSameArmedSource(selection)
        } else {
          this.assertNotStopped()
          this.assertRequestActive(signal)
          await this.uia.setValue(hwnd, options.element_ref, text, scope)
          this.assertSameArmedSource(selection)
        }
        if (options.submit) {
          this.assertNotStopped()
          this.assertRequestActive(signal)
          await this.uia.focus(hwnd, options.element_ref, scope)
          this.assertSameArmedSource(selection)
          this.assertNotStopped()
          this.assertForeground(hwnd)
          this.assertRequestActive(signal)
          this.input.pressEnter()
          this.assertSameArmedSource(selection)
        }
      } else {
        this.assertForeground(hwnd)
        auditTarget = `focused element · [redacted ${text.length} chars]`
        this.assertNotStopped()
        this.assertRequestActive(signal)
        this.input.typeText(text)
        this.assertSameArmedSource(selection)
        if (options.submit) {
          this.assertNotStopped()
          this.assertRequestActive(signal)
          this.input.pressEnter()
          this.assertSameArmedSource(selection)
        }
      }
      await this.appendAudit(client, 'type', selection, auditTarget, actionMethod, 'ok', null)
      return { ok: true, method: actionMethod === 'uia' ? 'uia' : 'coord' }
    } catch (error) {
      if (selection) await this.appendFailure(client, 'type', selection, auditTarget, actionMethod, error)
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.disarm('quit')
    this.unsubscribeCapture()
    this.unsubscribeState()
    await Promise.all([this.uia.dispose(), this.ocr.dispose()])
  }

  private assertArmed(): SourceSelection {
    this.assertWindows()
    this.assertNotStopped()
    const selection = this.requireSelection()
    if (this.armed !== sourceKey(selection)) throw new ScreenMcpError('control_not_armed', 'Interactive control is not armed for the selected source')
    return selection
  }

  private async refreshArmedSelection(): Promise<SourceSelection> {
    this.assertWindows()
    this.assertNotStopped()
    await this.capture.refreshWindowDialog()
    return this.assertArmed()
  }

  private async refreshWriteSelection(): Promise<SourceSelection> {
    this.assertWindows()
    this.assertNotStopped()
    await this.capture.refreshWindowDialog()
    this.assertNotStopped()
    return this.requireSelection()
  }

  private async requireWriteAccess(client: string, action: InteractiveWriteAction, selection: SourceSelection, signal?: AbortSignal): Promise<SourceSelection> {
    if (this.armed === sourceKey(selection)) return selection
    if (!this.interactiveRequests) throw controlNotArmedError()
    const allowed = await this.interactiveRequests.request({ client, action, selection }, signal)
    this.assertRequestActive(signal)
    if (!allowed) {
      this.assertNotStopped()
      this.requireSelection()
      throw controlNotArmedError('ScreenMCP stayed Read-only; the write was not performed')
    }
    const current = this.assertArmed()
    if (!sameSelection(selection, current)) throw controlNotArmedError('The selected source changed while Interactive access was requested')
    return current
  }

  private assertSameArmedSource(selection: SourceSelection): void {
    this.assertNotStopped()
    const current = this.capture.getSelection()
    if (!current || this.armed !== sourceKey(current) || sourceKey(current) !== sourceKey(selection))
      throw new ScreenMcpError('control_not_armed', 'Interactive control was disarmed while the action was running')
  }

  private assertNotStopped(): void {
    if (this.appState.isStopped()) throw stoppedError()
  }

  private assertRequestActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ScreenMcpError('capture_failed', 'The MCP request was cancelled before input')
  }

  private assertWindows(): void {
    if (this.platform !== 'win32') throw new ScreenMcpError('control_unavailable', 'Interactive control is available on Windows only')
  }

  private assertForeground(hwnd: number): void {
    if (this.input.foregroundHwnd() !== hwnd) throw new ScreenMcpError('out_of_bounds', 'The selected window is not focused; no keystrokes were sent')
  }

  private assertHitTarget(selection: SourceSelection, point: ScreenPoint): void {
    if (this.input.rootWindowFromPoint(point) !== captureHwnd(selection)) throw new ScreenMcpError('out_of_bounds', 'The click would land on another window; no click was sent')
  }

  private requireSelection(): SourceSelection {
    const selection = this.capture.getSelection()
    if (!selection) throw new ScreenMcpError('no_source', 'Select a source before using interactive control')
    return selection
  }

  private async resolveElement(selection: SourceSelection, ref: string) {
    if (!/^s\d+e\d+$/.test(ref)) throw new ScreenMcpError('element_not_found', 'Unknown element reference; call list_elements first')
    const element = await this.uia.snapshot(captureHwnd(selection), ref)
    this.assertSameArmedSource(selection)
    if (!element) throw new ScreenMcpError('element_stale', 'The element moved or vanished; call list_elements again')
    return element
  }

  private setArmed(key: string): void {
    this.armed = key
    this.publishState()
  }

  private publishState(): void {
    const state = this.getState()
    publish('control:state', state)
    for (const listener of this.listeners) listener(state)
  }

  private appendFailure(client: string, action: AuditEntry['action'], selection: SourceSelection, target: string, method: AuditEntry['method'], error: unknown): Promise<unknown> {
    const known = asScreenMcpError(error)
    return this.appendAudit(client, action, selection, target, method, known.code, known.message).catch(() => undefined)
  }

  private appendAudit(client: string, action: AuditEntry['action'], selection: SourceSelection, target: string, method: AuditEntry['method'], outcome: string, error: string | null): Promise<unknown> {
    return this.audit.append({
      client,
      action,
      source: selection.label,
      sourceKind: selection.kind,
      changed: null,
      hash: null,
      bytes: null,
      thumbnail: null,
      error,
      target,
      method,
      outcome,
    })
  }
}

function matchesFilter(role: string, name: string, filter: ElementFilter): boolean {
  if (filter.role && role.toLocaleLowerCase() !== filter.role.toLocaleLowerCase()) return false
  if (filter.name_contains && !name.toLocaleLowerCase().includes(filter.name_contains.toLocaleLowerCase())) return false
  return true
}

function validateText(text: string, submit: boolean): void {
  if (text.length > 10_000 || text.includes('\0')) throw new ScreenMcpError('text_rejected', 'Text must contain at most 10,000 characters and no NUL characters')
  if (!text.length && !submit) throw new ScreenMcpError('text_rejected', 'Text is empty and submit was not requested')
}

function rectLabel(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x},${rect.y},${rect.width}×${rect.height}`
}

function stoppedError(): ScreenMcpError {
  return new ScreenMcpError('capture_stopped', 'ScreenMCP access mode is Off; ask the human to switch to Interactive')
}

function elementActionsUnavailable(): ScreenMcpError {
  return new ScreenMcpError('element_actions_unavailable', 'Element actions require a window source; monitor and region sources support coordinate click and region OCR only')
}

function controlNotArmedError(message = 'Interactive control is not armed for the selected source'): ScreenMcpError {
  return new ScreenMcpError('control_not_armed', message)
}

function sameSelection(left: SourceSelection, right: SourceSelection): boolean {
  if (left.kind === 'monitor') return right.kind === 'monitor' && left.captureId === right.captureId && left.displayId === right.displayId
  else if (left.kind === 'window') return right.kind === 'window' && left.captureId === right.captureId
  else if (left.kind === 'region') return right.kind === 'region' && left.captureId === right.captureId && left.displayId === right.displayId && equalRect(left.region, right.region)
  else
    throw new Error(`Unknown source kind: ${JSON.stringify(left.kind)}`)
}

function equalRect(left: SourceSelection['region'], right: SourceSelection['region']): boolean {
  if (!left || !right) return left === right
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}
