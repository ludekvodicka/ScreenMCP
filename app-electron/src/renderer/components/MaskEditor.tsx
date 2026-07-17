import type { MaskRect, Rect } from '../../shared/contracts'
import { RectangleEditor } from './RectangleEditor'

interface Props {
  sourceWidth: number
  sourceHeight: number
  masks: MaskRect[]
  editing: boolean
  onChange: (masks: MaskRect[]) => void
  onDone: () => void
}

export function MaskEditor({ sourceWidth, sourceHeight, masks, editing, onChange, onDone }: Props) {
  return (
    <RectangleEditor sourceWidth={sourceWidth} sourceHeight={sourceHeight} rectangles={masks} drawing={editing} canDraw layerClassName="mask-layer" rectangleClassName="mask-rect" instructionClassName="mask-instruction" instruction="Drag to hide sensitive content · Hold Ctrl to move the draft" itemName={() => 'redaction'} createRectangle={(rect: Rect) => ({ id: crypto.randomUUID(), ...rect })} onChange={onChange} onDone={onDone} />
  )
}
