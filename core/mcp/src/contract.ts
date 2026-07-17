import * as z from 'zod/v4'

export const lookInput = {
  changed_since: z.string().regex(/^[a-f\d]{16}$/i).optional().describe('dHash returned by a previous look'),
}

export const waitForChangeInput = {
  timeout_ms: z.number().int().min(1_000).max(120_000).default(30_000),
}

export const listElementsInput = {
  role: z.string().trim().min(1).max(100).optional(),
  name_contains: z.string().trim().min(1).max(200).optional(),
}

export const readTextInput = {
  element_ref: z.string().trim().min(1).max(100).optional(),
  region: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
}

export const clickInput = {
  element_ref: z.string().trim().min(1).max(100).optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  button: z.enum(['left', 'right']).default('left'),
  double: z.boolean().default(false),
}

export const typeTextInput = {
  text: z.string().max(10_000),
  element_ref: z.string().trim().min(1).max(100).optional(),
  append: z.boolean().default(false),
  submit: z.boolean().default(false),
}

export type ToolErrorCode =
  | 'capture_stopped'
  | 'no_source'
  | 'capture_failed'
  | 'control_not_armed'
  | 'control_unavailable'
  | 'element_actions_unavailable'
  | 'element_not_found'
  | 'element_stale'
  | 'out_of_bounds'
  | 'not_invokable'
  | 'not_editable'
  | 'injection_failed'
  | 'ocr_failed'
  | 'text_rejected'

export interface HighlightInfo {
  n: number
  shape: 'rect'
  label?: string
  x: number
  y: number
  width: number
  height: number
}

export interface SourceDescription {
  kind: 'monitor' | 'window' | 'region'
  label: string
  width: number
  height: number
  masks: number
  highlights: HighlightInfo[]
  policy: {
    format: 'jpeg' | 'png'
    jpegQuality: number
    maxLongSide: number | null
  }
}

export interface UnchangedLook {
  changed: false
  hash: string
  highlights?: HighlightInfo[]
}

export interface ChangedLook {
  changed: true
  hash: string
  data: Buffer
  format: 'jpeg' | 'png'
  width: number
  height: number
  capturedAt: number
  frameAgeMs: number
  nearlyBlack: boolean
  source: Pick<SourceDescription, 'kind' | 'label'>
  highlights?: HighlightInfo[]
}

export type LookOutcome = UnchangedLook | ChangedLook
