# Active modal dialog following

## Decision

On Windows, a selected window can temporarily follow its active modal dialog. `Follow active dialogs`
is enabled by default and can be disabled in Settings. The feature still captures exactly one source:
it switches the persistent stream from the human-selected parent HWND to the modal HWND, then restores
the parent after the modal closes.

A direct dialog stream is required because a Win32 modal is an owned top-level window, not pixels inside
the parent surface. It may extend outside the parent bounds. Parent composition would either clip those
pixels or require multiple synchronized streams and a new coordinate system.

## Eligibility

Following applies only when all conditions hold:

- the logical source is a Windows window;
- the selected parent HWND is disabled;
- `GetWindow(parent, GW_ENABLEDPOPUP)` returns a different owned top-level HWND;
- the popup is visible, enabled, non-cloaked, positive-size, and belongs to the same process;
- Chromium accepts the exact external `window:*:0` source. Electron enumeration supplies that source
  when available; otherwise ScreenMCP derives it only after the native checks above pass.

The disabled-parent requirement excludes modeless palettes, notifications, and other owned windows.
The native picker continues to exclude owned dialogs as initial targets; this runtime rule operates only
inside the application lineage selected by the human.

## Runtime sequence

1. `CaptureController` keeps a private logical root and a separately published active selection.
2. Before a frame, source description, or control operation, `WindowDialogFollower` probes the root.
3. A modal present in Electron's list uses that source object. An omitted modal uses an internal trusted
   source object synthesized from its validated unsigned HWND; manual selection cannot request this
   fallback. Both paths restart the one stream and publish `Parent › Dialog` with the dialog's capture
   dimensions.
4. The frame and its exact selection travel together, preventing stale parent geometry from reaching
   masks, highlights, metadata, OCR, or coordinates. No modal restores the root.
5. If a followed dialog disappears during a grab, the controller restores and retries the root once.

Controller operations serialize manual selection, follow refresh, stream restart, and grab. The visible
preview polls every 750 ms, while a hidden app performs the same refresh at the next MCP or control call;
no background desktop polling runs while idle. Changing the setting asks for an immediate refresh.

## Consent and per-source state

Every parent/dialog transition emits the normal `source:changed` event. Interactive is therefore revoked
synchronously before any native effect, and the human must grant it separately for the dialog and again
for the restored parent. Control operations refresh before checking their grant.

The active dialog label is a separate source key, so frame policy, redaction masks, and highlights are not
silently reused from a differently sized parent. The retained parent's original annotation coordinate
space survives a resize while its dialog is active. Turning the setting off restores the parent and keeps
future popups out of the capture.

## Limits

- Windows only; monitor, region, macOS, Linux, and Wayland sources do not follow dialogs.
- Chromium can still reject or return a protected/stale frame for an unusual direct HWND. Startup failure
  keeps the last valid parent or dialog stream.
- Modeless owned windows are deliberately not followed.
- This is switching, not composition: the modal frame replaces the parent frame while active.

Key files are `window-dialog-follower.ts`, `native-window-enum.ts`, `trusted-window-capture.ts`,
`capture-controller.ts`, `capture-stream.ts`, `capture-service.ts`, `control-service.ts`, and
`coordinate-resolver.ts`.
