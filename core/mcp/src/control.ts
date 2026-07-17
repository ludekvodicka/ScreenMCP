export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementInfo {
  ref: string
  role: string
  name: string
  value?: string
  enabled: boolean
  bounds: Rect
}

export interface ElementFilter {
  role?: string
  name_contains?: string
}

export type ClickTarget = { element_ref: string } | { x: number; y: number }
export type ReadTarget = { element_ref: string } | { region: Rect }

export interface ListElementsResult {
  elements: ElementInfo[]
  truncated: boolean
  source: { kind: string; label: string }
}

export interface OcrWord extends Rect {
  text: string
}

export interface ReadTextResult {
  text: string
  words?: OcrWord[]
  method: 'uia' | 'ocr'
}

export interface ActionResult {
  ok: true
  method: 'uia' | 'coord'
}

export interface ScreenControlService {
  listElements(client: string, filter?: ElementFilter): Promise<ListElementsResult>
  readText(client: string, target: ReadTarget): Promise<ReadTextResult>
  click(client: string, target: ClickTarget, options?: { button?: 'left' | 'right'; double?: boolean }, signal?: AbortSignal): Promise<ActionResult>
  typeText(client: string, text: string, options?: { element_ref?: string; append?: boolean; submit?: boolean }, signal?: AbortSignal): Promise<ActionResult>
}
