import type { RawFrame } from '../../../core/capture/src/types'
import type { SourceSelection } from '../shared/contracts'
import type { CaptureStream } from './capture-stream'
import { enumerateSources, isWayland } from './source-enum'
import { sourceRect, type NormalizedRect } from './source-picker-geometry'
import { publish } from './streams'
import type { TrustedWindowCaptureSource } from './trusted-window-capture'
import { WindowDialogFollower, type WindowDialogResolver } from './window-dialog-follower'

export interface CaptureSnapshot {
  frame: RawFrame
  selection: SourceSelection
}

export interface CaptureControllerOptions {
  followActiveDialogs?: () => boolean
  dialogResolver?: WindowDialogResolver
}

export class CaptureController {
  private selection: SourceSelection | null = null
  private rootSelection: SourceSelection | null = null
  private trustedWindowSource: TrustedWindowCaptureSource | null = null
  private listeners = new Set<(selection: SourceSelection | null) => void>()
  private operation: Promise<unknown> = Promise.resolve()
  private followActiveDialogs: () => boolean
  private dialogResolver: WindowDialogResolver

  constructor(private stream: CaptureStream, options: CaptureControllerOptions = {}) {
    this.followActiveDialogs = options.followActiveDialogs ?? (() => true)
    this.dialogResolver = options.dialogResolver ?? new WindowDialogFollower()
  }

  getSelection(): SourceSelection | null {
    return this.selection ? structuredClone(this.selection) : null
  }

  subscribe(listener: (selection: SourceSelection | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  listSources() {
    return enumerateSources()
  }

  select(input: Omit<SourceSelection, 'width' | 'height'>): Promise<SourceSelection> {
    return this.enqueue(async () => {
      if (input.kind === 'monitor' || input.kind === 'window') {
        if (!input.captureId || !input.label) throw new TypeError('Capture source id and label are required')
      } else if (input.kind === 'region') {
        if (!input.captureId || !input.label || !input.region || !Number.isFinite(input.region.x) || !Number.isFinite(input.region.y) || !Number.isFinite(input.region.width) || !Number.isFinite(input.region.height) || input.region.width < 1 || input.region.height < 1) throw new TypeError('A valid monitor region is required')
      } else throw new Error(`Unknown source kind: ${JSON.stringify(input.kind)}`)
      const dimensions = await this.startWithRollback(input.captureId)
      let selection: SourceSelection
      if (input.kind === 'monitor') selection = { captureId: input.captureId, kind: input.kind, label: input.label, width: dimensions.width, height: dimensions.height, captureWidth: dimensions.width, captureHeight: dimensions.height, ...(input.displayId ? { displayId: input.displayId } : {}) }
      else if (input.kind === 'window') selection = { captureId: input.captureId, kind: input.kind, label: input.label, width: dimensions.width, height: dimensions.height, captureWidth: dimensions.width, captureHeight: dimensions.height }
      else if (input.kind === 'region') {
        const x = Math.max(0, Math.min(dimensions.width - 1, Math.floor(input.region!.x)))
        const y = Math.max(0, Math.min(dimensions.height - 1, Math.floor(input.region!.y)))
        const width = Math.max(1, Math.min(dimensions.width - x, Math.floor(input.region!.width)))
        const height = Math.max(1, Math.min(dimensions.height - y, Math.floor(input.region!.height)))
        selection = { captureId: input.captureId, kind: input.kind, label: input.label, region: { x, y, width, height }, width, height, captureWidth: dimensions.width, captureHeight: dimensions.height, ...(input.displayId ? { displayId: input.displayId } : {}) }
      } else throw new Error(`Unknown source kind: ${JSON.stringify(input.kind)}`)
      this.setManualSelection(selection)
      return this.getSelection()!
    })
  }

  selectNormalizedRegion(captureId: string, label: string, region: NormalizedRect, displayId?: string): Promise<SourceSelection> {
    return this.enqueue(async () => {
      if (!captureId || !label) throw new TypeError('Capture source id and label are required')
      const dimensions = await this.startWithRollback(captureId)
      const rect = sourceRect(region, dimensions)
      this.setManualSelection({ captureId, kind: 'region', label, region: rect, width: rect.width, height: rect.height, captureWidth: dimensions.width, captureHeight: dimensions.height, ...(displayId ? { displayId } : {}) })
      return this.getSelection()!
    })
  }

  async selectPortal(): Promise<SourceSelection> {
    if (!isWayland()) throw new Error('The system portal picker is only used on Wayland')
    return this.select({ captureId: 'portal', kind: 'monitor', label: 'System-selected source' })
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.stream.stop()
      this.selection = null
      this.rootSelection = null
      this.trustedWindowSource = null
      this.publishSelection()
    })
  }

  refreshWindowDialog(): Promise<SourceSelection | null> {
    return this.enqueue(() => this.refreshWindowDialogNow())
  }

  grab(): Promise<CaptureSnapshot> {
    return this.enqueue(async () => {
      await this.refreshWindowDialogNow()
      const selection = this.selection
      if (!selection) throw new Error('No source selected')
      try {
        const frame = await this.stream.grabFrame()
        return { frame, selection: structuredClone(selection) }
      } catch (error) {
        if (selection.followedFrom && this.rootSelection) {
          try {
            await this.activateSelection(this.rootSelection, false)
            const root = this.selection
            if (!root) throw new Error('The parent source could not be restored', { cause: error })
            const frame = await this.stream.grabFrame()
            return { frame, selection: structuredClone(root) }
          } catch (recoveryError) {
            await this.failSelection()
            throw new Error(`Dialog capture recovery failed after ${error instanceof Error ? error.message : String(error)}`, { cause: recoveryError })
          }
        }
        await this.failSelection()
        throw error
      }
    })
  }

  private async refreshWindowDialogNow(): Promise<SourceSelection | null> {
    const current = this.selection
    const root = this.rootSelection
    if (!current || !root) return null
    if (root.kind === 'monitor' || root.kind === 'region') return this.getSelection()
    else if (root.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(root.kind)}`)
    if (!this.followActiveDialogs()) return this.restoreRoot(root)
    let resolution
    try { resolution = await this.dialogResolver.resolve(root) }
    catch { return this.getSelection() }
    if (resolution.kind === 'root') return this.restoreRoot(root)
    else if (resolution.kind === 'dialog') {
      let trustedWindowSource: TrustedWindowCaptureSource | undefined
      if (resolution.capture.kind === 'listed') trustedWindowSource = undefined
      else if (resolution.capture.kind === 'unlisted') trustedWindowSource = { kind: 'verified-unlisted-window', id: resolution.capture.id, name: resolution.label }
      else throw new Error(`Unknown dialog capture target: ${JSON.stringify(resolution.capture)}`)
      if (current.captureId === resolution.capture.id) return this.getSelection()
      const followed: SourceSelection = {
        captureId: resolution.capture.id,
        kind: 'window',
        label: `${root.label} › ${resolution.label}`,
        width: 1,
        height: 1,
        followedFrom: { captureId: root.captureId, label: root.label },
      }
      try { return await this.activateSelection(followed, true, trustedWindowSource) }
      catch (error) {
        if (this.selection) return this.getSelection()
        throw error
      }
    } else throw new Error(`Unknown dialog resolution: ${JSON.stringify(resolution)}`)
  }

  private restoreRoot(root: SourceSelection): Promise<SourceSelection> {
    if (this.selection?.captureId === root.captureId) return Promise.resolve(this.getSelection()!)
    return this.activateSelection(root, false)
  }

  private async activateSelection(input: SourceSelection, resetDimensions: boolean, trustedWindowSource?: TrustedWindowCaptureSource): Promise<SourceSelection> {
    const dimensions = await this.startWithRollback(input.captureId, trustedWindowSource)
    this.selection = resetDimensions
      ? { ...structuredClone(input), width: dimensions.width, height: dimensions.height, captureWidth: dimensions.width, captureHeight: dimensions.height }
      : structuredClone(input)
    this.trustedWindowSource = trustedWindowSource ? structuredClone(trustedWindowSource) : null
    this.publishSelection()
    return this.getSelection()!
  }

  private setManualSelection(selection: SourceSelection): void {
    this.selection = structuredClone(selection)
    this.rootSelection = structuredClone(selection)
    this.trustedWindowSource = null
    this.publishSelection()
  }

  private async failSelection(): Promise<void> {
    await this.stream.stop().catch(() => undefined)
    this.selection = null
    this.rootSelection = null
    this.trustedWindowSource = null
    this.publishSelection()
  }

  private async startWithRollback(captureId: string, trustedWindowSource?: TrustedWindowCaptureSource): Promise<{ width: number; height: number }> {
    const previous = this.selection
    const previousTrustedWindowSource = this.trustedWindowSource
    try { return await this.stream.start(captureId, trustedWindowSource) }
    catch (error) {
      if (previous) {
        try { await this.stream.start(previous.captureId, previousTrustedWindowSource ?? undefined) }
        catch {
          this.selection = null
          this.rootSelection = null
          this.trustedWindowSource = null
          this.publishSelection()
        }
      } else await this.stream.stop().catch(() => undefined)
      throw error
    }
  }

  private publishSelection(): void {
    const selection = this.getSelection()
    publish('source:changed', selection)
    for (const listener of this.listeners) listener(selection)
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.operation.then(run, run)
    this.operation = next.catch(() => undefined)
    return next
  }
}
