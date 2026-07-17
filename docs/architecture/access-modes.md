# Access modes

## Decision

ScreenMCP exposes one three-state runtime access model: `Off`, `Read-only`, and `Interactive`. `Off`
reuses the existing global STOP gate instead of introducing a second blocker. The loopback MCP
transport stays connected while Off, but every capture, resource, source-description, OCR, and input
operation returns `capture_stopped`. This permits an immediate local resume without reconnecting MCP
clients while still serving no screen data or effects.

The authoritative mode is derived rather than stored separately:

| `AppState.stopped` | Control armed | Access mode |
| --- | --- | --- |
| `true` | either value | Off |
| `false` | `false` | Read-only |
| `false` | `true` | Interactive |

`app-electron/src/shared/access-mode.ts` owns this derivation. Renderer chips and panels use the same
helper; main-process enforcement remains in `AppState` and `ElectronControlService`.

## Transitions

| Requested mode | Main-process transition |
| --- | --- |
| Off | Set stopped. The existing synchronous STOP subscription revokes any Interactive grant. |
| Read-only | Revoke control first, then clear stopped. A previous grant can never reappear during resume. |
| Interactive | Clear stopped, then synchronously arm the currently selected Windows source. If validation fails after leaving Off, restore Off. |

The header and tray STOP controls are emergency aliases for Off. Their Resume action always returns to
Read-only because entering Off already revoked control. Changing or clearing the source revokes
Interactive; it produces Read-only when serving is active and remains Off while stopped.

Renderer mode changes cross one validated `access:set-mode` IPC boundary. The renderer cannot compose
resume and arm as separate calls. Native input paths still check stopped and the source-bound grant
immediately before and after effects.

## Read-only write escalation

A supported MCP `click` or `type_text` received in Read-only opens the main window and waits up to 120
seconds for a human decision. Approval uses the same `AccessModeController.setMode('interactive')`
transition as the visible mode switch, then the original tool call revalidates its abort signal, source,
grant, target, and STOP state before continuing. Denial or timeout leaves Read-only and returns
`control_not_armed` without input.

This is a mode request, not approval of one action: Interactive applies to every connected MCP client for
the current source until an existing revocation event. `list_elements` and `read_text` remain immediately
blocked in Read-only and do not open the write prompt. Off never prompts. See
[interactive escalation](interactive-escalation.md).

## Startup default

`settings.json` stores `accessModeDefault` as `off` or `read-only`; missing, malformed, legacy, and
`interactive` values normalize to `read-only`. The default is applied immediately after settings load,
before the MCP host, capture/control services, tray, or window become usable. Editing the setting affects
only the next process launch and does not change the current runtime mode.

Interactive is intentionally not a startup option. No source is selected at launch, so persisting it
would either report a mode that is not enforceable or silently grant interaction to a source selected
later. Interactive therefore always requires an explicit runtime choice for the current source.

## Entry points

- Types and derivation: `app-electron/src/shared/contracts.ts`, `shared/access-mode.ts`
- Main transition and startup application: `app-electron/src/main/access-mode.ts`, `main/index.ts`
- Read-only write request: `app-electron/src/main/interactive-request-service.ts`
- Enforcement: `app-electron/src/main/app-state.ts`, `capture-service.ts`, `control-service.ts`
- UI and settings: `app-electron/src/renderer/components/ControlPanel.tsx`, `SettingsPanel.tsx`, `App.tsx`
