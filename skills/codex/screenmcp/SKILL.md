---
name: screenmcp
description: Inspect a monitor, window, or region explicitly selected by the human through the local ScreenMCP server. Use for visual debugging, checking desktop UI state, watching an app for meaningful changes, or reading content that is visible only on the user's screen. Trigger when the user asks to look at, inspect, watch, or verify their screen or a desktop application.
---

# ScreenMCP

Use only the source the human selected in ScreenMCP. Never imply access to another window, monitor, or region.

## Register

ScreenMCP installs this skill automatically. Ask the human to start ScreenMCP first. If the
`screenmcp` MCP tools are not listed yet, run the `register.mjs` beside this `SKILL.md` using its
absolute path:

```sh
node <screenmcp-skill-directory>/register.mjs
```

Restart or reconnect Codex after registration if the MCP tools were already initialized.

## Inspect

1. Call `describe_source` when source bounds, format, or mask count matter.
2. Call `look` without `changed_since` for the first frame.
3. Read the returned text metadata and retain its `hash`.
4. Call `look` with `changed_since` only for an immediate conditional refresh.
5. Prefer `wait_for_change` with a bounded timeout when watching an app. Carry the newest hash into the next iteration.

Treat `changed: false` as a complete result. Do not request another image merely to confirm it.

On Windows, ScreenMCP may replace a selected parent window with its active modal dialog and return a
`Parent › Dialog` source label. Treat that dialog as the whole current source. The automatic switch and
the return to the parent each revoke Interactive; ask the human for a fresh grant instead of reusing refs
or coordinates from the prior source.

## Highlights — the human is pointing

The human may draw yellow highlight rectangles in ScreenMCP. Each is burned into the image as an outline with a numeric badge and listed in `highlights` metadata as `{ "n": 2, "shape": "rect", "label": "save button", "x": 40, "y": 610, "width": 300, "height": 88 }`. `n` matches the visible badge; coordinates are pixels in the `width`/`height` space of the same payload.

When the user refers to "this button", a highlighted area, or something they marked, call `look` without `changed_since` and resolve the reference against `highlights`: prefer its label, then badge number or position. Prioritize that region when reading the frame. An absent `highlights` field means none exist. A highlight points; a mask hides. A highlight never widens access, and pixels under an overlapping redaction stay black.

## Control — only when the human allows interaction

ScreenMCP has three human-selected access modes. **Off** refuses every screen and control call while the MCP connection may remain open. **Read-only** permits inspection calls but refuses control. **Interactive** permits source-bound control on Windows. In Read-only, `list_elements` and `read_text` fail immediately with `control_not_armed`. A supported `click` or `type_text` instead waits up to 120 seconds while ScreenMCP asks the human to switch modes; if accepted, the same tool call continues. If it returns `control_not_armed`, the human denied or did not answer; tell them and do not retry automatically. The grant persists until the human chooses Read-only or Off, presses STOP, changes the source, or quits ScreenMCP — there is no focus or idle timeout.

- `list_elements` works only for a window source. It returns opaque `ref` values, accessible names/roles, and bounds in the same payload pixels as `look` and highlights. Monitor/region sources return `element_actions_unavailable`.
- `read_text` accepts an `element_ref` for exact UIA text or a payload-pixel `region` for OCR. Region OCR honors black redaction masks. UIA element reads access live accessibility text and are not filtered by pixel masks.
- Prefer `click` with `{ "element_ref": "e12" }` because UIA Invoke does not move the cursor. Coordinate `{ "x", "y" }` clicks move the real cursor and must stay inside the payload bounds.
- `type_text` replaces an accessible field by default. Use `append` for synthesized keystrokes and `submit` for Enter. ScreenMCP audits only the target and character count, never the raw text.
- On `element_stale`, call `list_elements` again. Do not reuse old refs. On `out_of_bounds`, correct the target; never broaden the source automatically.
- Elevated windows, games/canvas UIs, and third-party Chromium content can be inaccessible to UIA. Use region OCR plus a coordinate click where safe, or explain that the target is out of reach.
- Redaction still wins. Never ask the human to weaken a mask in order to act.

## Respect control boundaries

- If the server reports `capture_stopped`, tell the user ScreenMCP access is Off and make no more screen calls until they choose Read-only or Interactive. Do not retry while Off.
- If it reports `no_source`, ask the user to choose a source in ScreenMCP.
- If a frame is nearly black or stale, report that condition and ask the user to restore, unminimize, or reselect the source.
- Do not ask the user to weaken masks or broaden the source unless the requested task cannot be completed with the visible content.
- Keep watch loops finite and stop as soon as the requested visual condition is met.
