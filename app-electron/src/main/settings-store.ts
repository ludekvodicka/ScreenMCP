import { HIGHLIGHT_MAX_PER_SOURCE } from '../../../core/capture/src/highlights'
import type { AppSettings, FramePolicy, HighlightRect, MaskRect, ShortcutAction, ShortcutSettings, SourceSelection, StartupAccessMode } from '../shared/contracts'
import { readJsonFile, writeJsonAtomic } from './json-store'
import { settingsPath } from './paths'

const defaults: AppSettings = {
  closeAction: 'tray',
  accessModeDefault: 'read-only',
  followActiveDialogs: true,
  trayNoticeShown: false,
  hashThreshold: 4,
  jpegQuality: 80,
  maxLongSide: 1568,
  format: 'jpeg',
  auditThumbnailRetention: 100,
  sourcePolicies: {},
  masks: {},
  highlights: {},
  updates: {
    autoCheck: true,
    checkIntervalMinutes: 120,
  },
  shortcuts: {
    pickRegion: 'Scrolllock',
    pickWindow: 'Shift+Scrolllock',
  },
}

function normalizeMasks(value: unknown): MaskRect[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const mask = item as Partial<MaskRect>
    if (typeof mask.id !== 'string' || !mask.id || !Number.isFinite(mask.x) || !Number.isFinite(mask.y) || !Number.isFinite(mask.width) || !Number.isFinite(mask.height) || mask.width! <= 0 || mask.height! <= 0) return []
    return [{ id: mask.id, x: Math.max(0, mask.x!), y: Math.max(0, mask.y!), width: Math.min(1_000_000, mask.width!), height: Math.min(1_000_000, mask.height!) }]
  })
}

function normalizeHighlights(value: unknown): HighlightRect[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const highlight = item as Partial<HighlightRect>
    if (highlight.shape !== 'rect') return []
    if (typeof highlight.id !== 'string' || !highlight.id || !Number.isFinite(highlight.x) || !Number.isFinite(highlight.y) || !Number.isFinite(highlight.width) || !Number.isFinite(highlight.height) || highlight.width! <= 0 || highlight.height! <= 0) return []
    const label = typeof highlight.label === 'string' ? highlight.label.trim().slice(0, 120) : ''
    return [{ id: highlight.id, shape: 'rect' as const, ...(label ? { label } : {}), x: Math.max(0, highlight.x!), y: Math.max(0, highlight.y!), width: Math.min(1_000_000, highlight.width!), height: Math.min(1_000_000, highlight.height!) }]
  }).slice(0, HIGHLIGHT_MAX_PER_SOURCE)
}

function normalizePolicy(value: Partial<FramePolicy> | null | undefined, fallback: FramePolicy): FramePolicy {
  const format = value?.format === 'png' ? 'png' : value?.format === 'jpeg' ? 'jpeg' : fallback.format
  return {
    format,
    jpegQuality: Number.isInteger(value?.jpegQuality) ? Math.min(100, Math.max(1, value!.jpegQuality!)) : fallback.jpegQuality,
    maxLongSide: value?.maxLongSide === null ? null : Number.isInteger(value?.maxLongSide) ? Math.max(320, value!.maxLongSide!) : fallback.maxLongSide,
  }
}

function normalizeUpdateSettings(value: unknown): AppSettings['updates'] {
  if (!value || typeof value !== 'object') return structuredClone(defaults.updates)
  const updates = value as Partial<AppSettings['updates']>
  return {
    autoCheck: updates.autoCheck !== false,
    checkIntervalMinutes: Number.isInteger(updates.checkIntervalMinutes)
      ? Math.min(1_440, Math.max(15, updates.checkIntervalMinutes!))
      : defaults.updates.checkIntervalMinutes,
  }
}

function normalizeShortcuts(value: unknown): ShortcutSettings {
  const raw = value && typeof value === 'object' ? value as Partial<Record<ShortcutAction, unknown>> : {}
  const one = (action: ShortcutAction): string | null => {
    const candidate = raw[action]
    if (candidate === null) return null
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 64)
    return defaults.shortcuts[action]
  }
  return { pickRegion: one('pickRegion'), pickWindow: one('pickWindow') }
}

function normalizeStartupAccessMode(value: unknown): StartupAccessMode {
  if (value === 'off') return value
  else if (value === 'read-only') return value
  else return defaults.accessModeDefault
}

function normalize(value: Partial<AppSettings> | null): AppSettings {
  const closeAction = value?.closeAction === 'quit' ? 'quit' : 'tray'
  const format = value?.format === 'png' ? 'png' : 'jpeg'
  const fallback = { format, jpegQuality: Number.isInteger(value?.jpegQuality) ? Math.min(100, Math.max(1, value!.jpegQuality!)) : defaults.jpegQuality, maxLongSide: value?.maxLongSide === null ? null : Number.isInteger(value?.maxLongSide) ? Math.max(320, value!.maxLongSide!) : defaults.maxLongSide } satisfies FramePolicy
  const sourcePolicies = Object.fromEntries(Object.entries(value?.sourcePolicies ?? {}).map(([key, policy]) => [key, normalizePolicy(policy, fallback)]))
  const masks = Object.fromEntries(Object.entries(value?.masks ?? {}).map(([key, sourceMasks]) => [key, normalizeMasks(sourceMasks)]))
  const highlights = Object.fromEntries(Object.entries(value?.highlights ?? {}).map(([key, sourceHighlights]) => [key, normalizeHighlights(sourceHighlights)]))
  return {
    closeAction,
    accessModeDefault: normalizeStartupAccessMode(value?.accessModeDefault),
    followActiveDialogs: value?.followActiveDialogs !== false,
    trayNoticeShown: value?.trayNoticeShown === true,
    hashThreshold: Number.isInteger(value?.hashThreshold) ? Math.min(64, Math.max(0, value!.hashThreshold!)) : defaults.hashThreshold,
    jpegQuality: fallback.jpegQuality,
    maxLongSide: fallback.maxLongSide,
    format,
    auditThumbnailRetention: Number.isInteger(value?.auditThumbnailRetention) ? Math.max(0, value!.auditThumbnailRetention!) : defaults.auditThumbnailRetention,
    sourcePolicies,
    masks,
    highlights,
    updates: normalizeUpdateSettings(value?.updates),
    shortcuts: normalizeShortcuts(value?.shortcuts),
  }
}

export class SettingsStore {
  private value: AppSettings = structuredClone(defaults)

  async load(): Promise<AppSettings> {
    this.value = normalize(await readJsonFile<Partial<AppSettings>>(settingsPath()))
    return this.get()
  }

  get(): AppSettings {
    return structuredClone(this.value)
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = normalize({ ...this.value, ...patch })
    await writeJsonAtomic(settingsPath(), this.value)
    return this.get()
  }

  framePolicy(selection: SourceSelection): FramePolicy {
    const fallback = { format: this.value.format, jpegQuality: this.value.jpegQuality, maxLongSide: this.value.maxLongSide }
    return structuredClone(this.value.sourcePolicies[sourceKey(selection)] ?? fallback)
  }

  async setFramePolicy(selection: SourceSelection, policy: FramePolicy): Promise<AppSettings> {
    const fallback = { format: this.value.format, jpegQuality: this.value.jpegQuality, maxLongSide: this.value.maxLongSide }
    return this.update({ sourcePolicies: { ...this.value.sourcePolicies, [sourceKey(selection)]: normalizePolicy(policy, fallback) } })
  }

  masks(selection: SourceSelection): MaskRect[] {
    return structuredClone(this.value.masks[sourceKey(selection)] ?? [])
  }

  async setMasks(selection: SourceSelection, masks: MaskRect[]): Promise<MaskRect[]> {
    const normalized = normalizeMasks(masks)
    await this.update({ masks: { ...this.value.masks, [sourceKey(selection)]: normalized } })
    return this.masks(selection)
  }

  highlights(selection: SourceSelection): HighlightRect[] {
    return structuredClone(this.value.highlights[sourceKey(selection)] ?? [])
  }

  async setHighlights(selection: SourceSelection, highlights: HighlightRect[]): Promise<HighlightRect[]> {
    const normalized = normalizeHighlights(highlights)
    await this.update({ highlights: { ...this.value.highlights, [sourceKey(selection)]: normalized } })
    return this.highlights(selection)
  }
}

export function sourceKey(selection: SourceSelection): string {
  if (selection.kind === 'monitor') return `monitor:${selection.captureId}`
  else if (selection.kind === 'window') return `window:${selection.label}`
  else if (selection.kind === 'region') return `region:${selection.captureId}:${selection.region?.x ?? 0}:${selection.region?.y ?? 0}:${selection.region?.width ?? 0}:${selection.region?.height ?? 0}`
  else throw new Error(`Unknown source kind: ${JSON.stringify(selection.kind)}`)
}
