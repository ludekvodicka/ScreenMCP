import { createHash } from 'node:crypto'
import { applyMasks, scaleMasks } from '../../../core/capture/src/masks'
import { drawHighlights, scaleHighlights } from '../../../core/capture/src/highlights'
import { cropFrame } from '../../../core/capture/src/crop'
import { targetDimensions } from '../../../core/capture/src/downscale'
import { encodePreparedFrame, prepareFrame } from '../../../core/capture/src/encode'
import { hashDistance } from '../../../core/capture/src/dhash'
import type { EncodedFrame, FramePolicy, PreparedFrame, RawFrame } from '../../../core/capture/src/types'
import type { HighlightInfo, LookOutcome, SourceDescription } from '../../../core/mcp/src/contract'
import { ScreenMcpError } from '../../../core/mcp/src/errors'
import type { ScreenCaptureService } from '../../../core/mcp/src/service'
import type { HighlightRect, PreviewFrame, SourceSelection } from '../shared/contracts'
import type { AppState } from './app-state'
import type { AuditLog } from './audit-log'
import type { CaptureController } from './capture-controller'
import type { McpClients } from './mcp-clients'
import type { SettingsStore } from './settings-store'
import { createAuditThumbnail } from './audit-thumbnail'

interface PreparedCapture {
  frame: PreparedFrame
  policy: FramePolicy
  selection: SourceSelection
  sourceWidth: number
  sourceHeight: number
  highlightInfos: HighlightInfo[]
}

interface Size {
  width: number
  height: number
}

export interface CaptureFramePipeline {
  prepare(frame: RawFrame, maxLongSide: number | null): Promise<PreparedFrame>
  encode(frame: PreparedFrame, policy: FramePolicy): Promise<EncodedFrame>
}

const defaultFramePipeline: CaptureFramePipeline = { prepare: prepareFrame, encode: encodePreparedFrame }

export class ElectronCaptureService implements ScreenCaptureService {
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    private capture: CaptureController,
    private settings: SettingsStore,
    private appState: AppState,
    private audit: AuditLog,
    private clients: McpClients,
    private frames: CaptureFramePipeline = defaultFramePipeline,
  ) {}

  look(client: string, changedSince?: string): Promise<LookOutcome> {
    return this.enqueue(() => this.captureForClient(client, 'look', changedSince, false))
  }

  readCurrent(client: string): Promise<LookOutcome & { changed: true }> {
    return this.enqueue(async () => {
      const outcome = await this.captureForClient(client, 'resource', undefined, true)
      if (!outcome.changed) throw new Error('Forced resource capture returned unchanged')
      return outcome
    })
  }

  preview(): Promise<PreviewFrame | null> {
    return this.enqueue(async () => {
      if (!this.capture.getSelection()) return null
      const prepared = await this.prepareCapture()
      const frame = await this.encodeCapture(prepared)
      return {
        dataUrl: `data:image/${frame.format};base64,${frame.data.toString('base64')}`,
        format: frame.format,
        width: frame.width,
        height: frame.height,
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight,
        capturedAt: frame.capturedAt,
        frameAgeMs: frame.frameAgeMs,
      }
    })
  }

  controlFrame(): Promise<PreparedFrame> {
    return this.enqueue(async () => {
      const prepared = await this.prepareCapture()
      return { ...prepared.frame, rgba: new Uint8Array(prepared.frame.rgba) }
    })
  }

  async describeSource(): Promise<SourceDescription> {
    this.assertServing()
    await this.capture.refreshWindowDialog()
    this.assertServing()
    const selection = this.requireSelection()
    const settings = this.settings.framePolicy(selection)
    return {
      kind: selection.kind,
      label: selection.label,
      width: selection.width,
      height: selection.height,
      masks: this.settings.masks(selection).length,
      highlights: toHighlightInfos(this.settings.highlights(selection), selection),
      policy: settings,
    }
  }

  async waitForChange(client: string, timeoutMs: number): Promise<LookOutcome> {
    this.assertServing()
    this.requireSelection()
    const started = Date.now()
    const baseline = await this.enqueue(() => this.prepareCapture())
    let latest = baseline
    while (Date.now() - started < timeoutMs) {
      await this.waitWhileServing(Math.min(500, Math.max(1, timeoutMs - (Date.now() - started))))
      const current = await this.enqueue(() => this.prepareCapture())
      latest = current
      if (hashDistance(baseline.frame.hash, current.frame.hash) > this.settings.get().hashThreshold) {
        return this.enqueue(async () => {
          const encoded = await this.encodeCapture(current)
          const outcome = this.changedOutcome(encoded, current)
          this.clients.noteLook()
          await this.appendAudit(client, 'wait_for_change', outcome, encoded, null, current.selection)
          this.assertServing()
          return outcome
        })
      }
    }
    const outcome = this.unchangedOutcome(latest)
    await this.appendAudit(client, 'wait_for_change', outcome, null, null, latest.selection)
    return outcome
  }

  private async captureForClient(client: string, action: 'look' | 'resource', changedSince: string | undefined, force: boolean): Promise<LookOutcome> {
    try {
      this.assertServing()
      this.requireSelection()
      const prepared = await this.prepareCapture()
      const unchanged = !force && changedSince !== undefined && hashDistance(prepared.frame.hash, changedSince) <= this.settings.get().hashThreshold
      if (unchanged) {
        const outcome = this.unchangedOutcome(prepared)
        await this.appendAudit(client, action, outcome, null, null, prepared.selection)
        return outcome
      }
      const frame = await this.encodeCapture(prepared)
      const outcome = this.changedOutcome(frame, prepared)
      this.clients.noteLook()
      await this.appendAudit(client, action, outcome, frame, null, prepared.selection)
      this.assertServing()
      return outcome
    } catch (error) {
      const selection = this.capture.getSelection()
      await this.audit.append({
        client,
        action,
        source: selection?.label ?? null,
        sourceKind: selection?.kind ?? null,
        changed: null,
        hash: null,
        bytes: null,
        thumbnail: null,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async prepareCapture(): Promise<PreparedCapture> {
    this.assertServing()
    const { frame: rawCapture, selection } = await this.capture.grab()
    this.assertServing()
    const raw: RawFrame = { ...rawCapture, rgba: new Uint8Array(rawCapture.rgba) }
    let prepared: RawFrame
    if (selection.kind === 'region') prepared = cropFrame(raw, selection.region!)
    else if (selection.kind === 'monitor') prepared = raw
    else if (selection.kind === 'window') prepared = raw
    else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
    applyMasks(prepared.rgba, prepared.width, prepared.height, scaleMasks(this.settings.masks(selection), selection, prepared))
    const policy = this.settings.framePolicy(selection)
    const storedHighlights = this.settings.highlights(selection)
    if (storedHighlights.length)
      drawHighlights(prepared.rgba, prepared.width, prepared.height, scaleHighlights(storedHighlights, selection, prepared), highlightStrokeWidth(prepared.width, prepared.height, policy.maxLongSide))
    const sourceWidth = prepared.width
    const sourceHeight = prepared.height
    const frame = await this.frames.prepare(prepared, policy.maxLongSide)
    this.assertServing()
    frame.hash = mixHighlightFingerprint(frame.hash, storedHighlights)
    const highlightInfos = toHighlightInfos(scaleHighlights(storedHighlights, selection, frame), frame)
    return { frame, policy, selection, sourceWidth, sourceHeight, highlightInfos }
  }

  private async encodeCapture(prepared: PreparedCapture): Promise<EncodedFrame> {
    this.assertServing()
    const frame = await this.frames.encode(prepared.frame, prepared.policy)
    this.assertServing()
    return frame
  }

  private unchangedOutcome(prepared: PreparedCapture): LookOutcome {
    return { changed: false, hash: prepared.frame.hash, ...(prepared.highlightInfos.length ? { highlights: prepared.highlightInfos } : {}) }
  }

  private changedOutcome(frame: EncodedFrame, prepared: PreparedCapture): LookOutcome & { changed: true } {
    return {
      changed: true,
      hash: frame.hash,
      data: frame.data,
      format: frame.format,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      frameAgeMs: frame.frameAgeMs,
      nearlyBlack: frame.nearlyBlack,
      source: { kind: prepared.selection.kind, label: prepared.selection.label },
      ...(prepared.highlightInfos.length ? { highlights: prepared.highlightInfos } : {}),
    }
  }

  private async appendAudit(client: string, action: 'look' | 'wait_for_change' | 'resource', outcome: LookOutcome, frame: EncodedFrame | null, error: string | null, selection: SourceSelection): Promise<unknown> {
    if (frame) this.assertServing()
    const thumbnail = frame ? await createAuditThumbnail(frame.data) : undefined
    if (frame) this.assertServing()
    return this.audit.append({
      client,
      action,
      source: selection.label,
      sourceKind: selection.kind,
      changed: outcome.changed,
      hash: outcome.hash,
      bytes: outcome.changed ? outcome.data.length : null,
      thumbnail: null,
      error,
    }, thumbnail)
  }

  private assertServing(): void {
    if (this.appState.isStopped()) throw this.captureStoppedError()
  }

  private captureStoppedError(): ScreenMcpError {
    return new ScreenMcpError('capture_stopped', 'ScreenMCP access mode is Off; ask the human to switch to Read-only or Interactive.')
  }

  private waitWhileServing(milliseconds: number): Promise<void> {
    this.assertServing()
    return new Promise((resolve, reject) => {
      let settled = false
      let unsubscribe = (): void => undefined
      const finish = (error?: ScreenMcpError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(finish, milliseconds)
      unsubscribe = this.appState.subscribe(snapshot => {
        if (snapshot.stopped) finish(this.captureStoppedError())
      })
      if (settled) unsubscribe()
    })
  }

  private requireSelection(): SourceSelection {
    const selection = this.capture.getSelection()
    if (!selection) throw new ScreenMcpError('no_source', 'No source is selected in ScreenMCP; ask the human to pick one.')
    return selection
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.operation.then(run, run)
    this.operation = next.catch(() => undefined)
    return next
  }
}

export function highlightStrokeWidth(width: number, height: number, maxLongSide: number | null): number {
  const scale = targetDimensions(width, height, maxLongSide).width / width
  return Math.max(2, Math.round(3 / scale))
}

export function mixHighlightFingerprint(hash: string, highlights: readonly HighlightRect[]): string {
  if (!highlights.length) return hash
  const canonical = highlights.map(highlight => {
    if (highlight.shape === 'rect')
      return { id: highlight.id, shape: 'rect' as const, ...(highlight.label === undefined ? {} : { label: highlight.label }), x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }
    else throw new Error(`Unknown highlight shape: ${JSON.stringify(highlight.shape)}`)
  })
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical)).digest().readBigUInt64BE(0)
  return (BigInt(`0x${hash}`) ^ fingerprint).toString(16).padStart(16, '0')
}

export function toHighlightInfos(highlights: readonly HighlightRect[], size: Size): HighlightInfo[] {
  if (size.width < 1 || size.height < 1) throw new RangeError('Highlight metadata space must be positive')
  return highlights.map((highlight, index) => {
    if (highlight.shape === 'rect') {
      const x = Math.min(size.width - 1, Math.max(0, Math.round(highlight.x)))
      const y = Math.min(size.height - 1, Math.max(0, Math.round(highlight.y)))
      const right = Math.min(size.width, Math.max(x + 1, Math.round(highlight.x + highlight.width)))
      const bottom = Math.min(size.height, Math.max(y + 1, Math.round(highlight.y + highlight.height)))
      return { n: index + 1, shape: 'rect' as const, ...(highlight.label === undefined ? {} : { label: highlight.label }), x, y, width: right - x, height: bottom - y }
    } else throw new Error(`Unknown highlight shape: ${JSON.stringify(highlight.shape)}`)
  })
}
