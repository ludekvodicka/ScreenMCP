# Annotation rectangle editors

## Decision

Redaction masks and highlight annotations use one generic renderer interaction component,
`RectangleEditor<T>`. The two annotation types keep separate data collections, persistence paths,
visual styles, and capture semantics; only their rectangle editing behavior is shared.

This boundary prevents pointer and geometry behavior from drifting between a privacy mask and a visual
highlight. It does not merge their schemas or let renderer-only state bypass the established settings and
capture pipeline.

## Component boundary

| Layer | Entry point | Responsibility |
| --- | --- | --- |
| Shared interaction | `app-electron/src/renderer/components/RectangleEditor.tsx` | Source-coordinate conversion, draw, Ctrl draft translation, move, eight-handle resize, pointer capture/cancel, clamping, minimum size, controls, and percentage positioning |
| Redaction adapter | `MaskEditor.tsx` | Mask item creation, redaction instruction, black/red visual variant |
| Highlight adapter | `HighlightEditor.tsx` | Per-source limit, `shape: 'rect'`, badge numbering, label edit/commit, yellow visual variant |
| Host UI | `LivePreview.tsx` | Exact-aspect current-frame canvas, mutually exclusive Add modes, and existing mask/highlight persistence callbacks |
| Persistence | `settings-store.ts` through renderer IPC | Separate per-source `MaskRect[]` and `HighlightRect[]` collections |
| Pixel output | `capture-service.ts` and `core/capture` | Scale canonical geometry to the current frame, apply masks first, then draw highlights |

`RectangleEditor<T>` accepts any item with `id`, `x`, `y`, `width`, and `height`. Adapter callbacks create
the concrete item and render type-specific content. Stored contracts and IPC are unchanged.

## Interaction state machine

The active pointer interaction is an exhaustive discriminated union:

| State | Start target | Geometry rule | Commit |
| --- | --- | --- | --- |
| `draw` | Empty layer while the corresponding Add mode is active | Normal movement changes the active corner; Ctrl movement translates the current draft at constant size | Append only when width and height are each at least six source pixels |
| `move` | Circular four-way handle at the top-left | Apply pointer delta to the original rectangle, clamped on all source edges | Replace the matching item geometry |
| `resize` | A top/right/bottom/left side or four-corner hit zone | Apply pointer delta to one edge or both adjacent corner edges, preserve the opposite edge/corner, clamp each axis, and stop at six source pixels | Replace the matching item geometry |

Unknown interaction kinds, resize edges, and resize handles throw. Pointer capture keeps an interaction live outside the
visible rectangle; pointer cancel or lost capture discards it. Closing or switching Add mode discards an
unfinished draft.

Ctrl draft movement stores the anchor, active corner, last pointer, and visible rectangle together. If a
translation reaches a source edge, the pointer-to-corner offset is retained, so releasing Ctrl does not
make the draft jump. Sizing can then continue from the translated anchor.

## Coordinates and invariants

- All interaction math uses the selected source's canonical pixel coordinate space, not browser CSS pixels.
- DOM pointer coordinates are converted through the overlay layer's current bounding box. Rendered geometry
  is converted back to percentages, preserving alignment when the preview is resized.
- `LivePreview` mounts the encoded image and both editor layers inside one exact-aspect `preview-canvas`.
  The outer panel can leave side space to satisfy its viewport-height limit, but no editor covers that space.
- Every new rectangle is normalized, so drawing in any direction produces positive width and height.
- Move preserves width and height. Side resize preserves the opposite edge; corner resize preserves the
  diagonally opposite corner. Neither can flip through the rectangle.
- New and resized rectangles have a six-source-pixel minimum on each dimension and remain inside the source.
- The existing capture path remains authoritative for later window-size scaling and model-visible output.

## Hit testing and controls

Committed controls are available outside Add mode by product decision. Add mode gates only background
pointer-down that creates a new item.

- The rectangle body is pointer-transparent and is not a move target.
- A visible circular move handle sits outside the top-left corner; delete remains outside the top-right.
- Four 12-CSS-pixel border bands provide full-length top/right/bottom/left resize targets with directional
  cursors.
- Four 36×36-CSS-pixel corner envelopes are centered on the corners and extend 18 pixels beyond both
  adjacent sides. Their active hit shape is a 12-pixel diagonal band, so side targets remain reachable on
  short or narrow rectangles. Each envelope is capped to its half of a small rectangle, leaving a center
  gap instead of overlapping the opposite corners. They show outward-diagonal markers and use `nwse-resize`
  or `nesw-resize`.
- Corner targets sit above side bands. Move/delete controls sit above corners and therefore win inside their
  20-pixel circles. Highlight badge and label padding are shifted inward; the input remains editable outside
  the small top-corner zones.
- Mask and highlight layers keep deterministic z-order. Empty rectangle interiors do not block controls in
  the other layer, though exact overlapping handles resolve to the visually upper annotation.

## Constraints and trade-offs

- There is no rotation, aspect-ratio locking, snapping, or keyboard resize control.
- Move and resize persist immediately through the same callbacks as draw/delete; there is no undo transaction.
- Controls remain visible on small rectangles and can extend outside their bounds. The preview canvas clips
  anything beyond the selected source boundary.
- Browser-level tests supplement pure geometry tests because Vitest currently runs without jsdom.
