# Interactive control

Interactive control is a Windows-only capability layered on top of the existing single-source capture boundary. It does not change what source the model can select: only the human-facing UI can choose a window, monitor, or region.

## Tool surface

| Tool | Window source | Monitor / region source |
| --- | --- | --- |
| `list_elements` | UI Automation control tree with opaque refs | Refused with `element_actions_unavailable` |
| `read_text` | UIA value/name by ref or OCR region | OCR region only |
| `click` | UIA Invoke by ref or physical coordinate click | Physical coordinate click |
| `type_text` | UIA ValuePattern replace or focused keystrokes | Refused with `element_actions_unavailable` |

Element and OCR bounds use payload pixels: the same `width` and `height` returned with `look()`. Element refs such as `e12` are snapshots, not durable identifiers. A stale ref returns `element_stale`; the client must call `list_elements` again.

## Safety state machine

Control is the Interactive branch of the shared [three-state access model](access-modes.md). Its grant
is runtime-only and binds to the current source key. The renderer shows `Read-only` when absent,
`Interactive` while granted, and `Off` when the global stopped gate is active. Interactive can be
selected directly from Off when a valid Windows source exists; the main process performs resume and
arm as one transition and restores Off if arming fails.

Changing or clearing the source, automatically switching between a selected Windows parent and its
active modal dialog, selecting Off, pressing STOP, or quitting revokes the grant; there is
no focus or idle auto-revoke — interaction stays on while the human works in other applications until
they turn it off. Off/STOP wins over every other state. Native injection paths check the stopped gate
immediately before and after every effect; Resume returns to Read-only and never restores interaction.
Old `settings.control.enabled` values are ignored and removed on the next settings write. Interactive
is not an allowed startup default.

When a supported `click` or `type_text` reaches Read-only, ScreenMCP reveals its window and presents a
source-bound request to switch modes. The same MCP call waits for the decision. Approval refreshes any
eligible active dialog, enters Interactive through the shared access controller, restores a tray-hidden
or minimized ScreenMCP window to its prior presentation, and then re-checks every native safety boundary
before the effect. Denial, 120-second timeout, SDK abort, source change, Off/STOP, or quit produces no
delayed input. Concurrent writes share the one visible mode request but keep independent abort signals.
`list_elements` and `read_text` do not trigger this escalation.

Every enumerate, read, click, and type attempt is appended to the local audit log with client, source, target, method, and outcome. Typed content is never logged: the target contains only `[redacted N chars]`.

## Native implementation

`UiaClient` is a request/response proxy for an in-process Node `worker_thread`. The worker owns one COM MTA and a bounded `IUIAutomation` method set implemented through `koffi` vtable calls. The main Electron thread never blocks on a tree walk.

Enumeration starts at `ElementFromHandle` and uses the control-view walker, capped at 500 elements and depth 32. The worker owns each returned interface pointer until cache replacement or shutdown. It balances `Release`, `SysFreeString`, `SafeArrayUnaccessData`, `SafeArrayDestroy`, and `CoUninitialize`. Before an element action, the main process reads its label/bounds from the cached enumeration without walking the tree. The operation then performs one fresh re-resolution: first by `RuntimeId`, then by equal control type/name and the nearest bounds within 250 physical pixels.

`WinInput` encodes x64 `INPUT` records directly and calls `SendInput`. Mouse points are normalized across the physical virtual desktop with `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`; text emits key-down/up for each UTF-16 code unit. Immediately before append or Enter uses global `SendInput`, the service synchronously re-checks that the selected HWND is foreground. UIA Invoke and ValuePattern are preferred because they do not move the cursor.

## Coordinate boundary

The conversion chain is bidirectional:

```text
payload px ⇄ selected-source capture px ⇄ full monitor capture px ⇄ display DIP ⇄ physical screen px
```

Regions add or remove their capture-frame origin. Monitor conversion matches the display ID and uses Electron's per-monitor `dipToScreenPoint` / `screenToDipPoint`. Window conversion directly re-inspects the current native HWND rectangle, including an owned modal that the initial picker intentionally excludes. Points outside the payload and element rectangles not fully contained by the selected source fail with `out_of_bounds` before injection.

## OCR and redaction

Region OCR uses one lazy `tesseract.js` worker and bundled English language data. It crops `ElectronCaptureService.controlFrame()`, which is the post-mask, post-highlight, post-resize RGBA payload. Pixel redactions therefore remain black and OCR word boxes already align with model payload pixels.

UIA element reads are different: they return the selected control's live accessibility value and do not pass through pixel masks. This distinction is shown in the privacy model and agent skill.

## Limits

- macOS AX and Linux AT-SPI control are not implemented. The tools return `control_unavailable` there.
- Normal-integrity ScreenMCP cannot control elevated Windows applications because of UIPI.
- Games, canvas UIs, and custom-drawn controls may expose no useful UIA descendants. Use OCR and a coordinate click.
- Third-party Chromium/Electron content may not expose its accessibility tree until that target enables accessibility.
- Coordinate clicks move the user's real cursor and keystrokes affect the real foreground window.

Key files are `control-service.ts`, `interactive-request-service.ts`, `coordinate-resolver.ts`, `uia-client.ts`, `uia-worker.ts`, `win-input.ts`, `ocr.ts`, and `core/mcp/src/control.ts`.
