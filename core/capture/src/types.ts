export type SourceKind = 'monitor' | 'window' | 'region'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskRect extends Rect {
  id: string
}

export type HighlightShape = 'rect'

export interface HighlightRect extends Rect {
  id: string
  shape: HighlightShape
  label?: string
}

export interface FramePolicy {
  format: 'jpeg' | 'png'
  jpegQuality: number
  maxLongSide: number | null
}

export interface RawFrame {
  rgba: Uint8Array
  width: number
  height: number
  capturedAt: number
  frameAgeMs: number
}

export interface EncodedFrame {
  data: Buffer
  format: 'jpeg' | 'png'
  width: number
  height: number
  hash: string
  capturedAt: number
  frameAgeMs: number
  nearlyBlack: boolean
}

export interface PreparedFrame extends Omit<EncodedFrame, 'data' | 'format'> {
  rgba: Uint8Array
}
