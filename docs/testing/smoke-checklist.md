# Manual smoke checklist

Record the app version, OS version, desktop environment, and result for each run. Automated coverage intentionally contains one desktop-capture test: Linux/X11 under Xvfb. Everything below is a human check.

## Common

- [ ] Start ScreenMCP and confirm exactly one instance owns the localhost endpoint.
- [ ] Connect Claude Code and Codex at the same time; confirm both names appear in status, tray tooltip, and audit.
- [x] On the 2026-07-15 Windows dev machine, Whole screen enumerated Screen 1/2/3 exactly once; Screen 1 produced a 1568×882 JPEG preview.
- [ ] Select every available monitor in Whole screen and compare preview with `look()` dimensions.
- [ ] Drag a Rectangle on every monitor; include a negative-origin/rotated/mixed-DPI display where available and confirm the crop has no systematic offset.
- [x] On the 2026-07-15 Windows dev machine, Window highlighted a maximized Chrome HWND and captured it as a non-black 1568×858 JPEG.
- [x] On the 2026-07-15 Windows dev machine, Escape from Rectangle preserved the previous region stream.
- [ ] Repeat cancel with right-click and verify Window cancel preserves the previous source.
- [ ] Call `look(changed_since)` twice without a visual change; confirm the second response contains no image.
- [ ] Call `wait_for_change`, change the source, and confirm one image arrives.
- [ ] Complete a screenshot and control action; confirm the header chip switches between `Last screenshot` and `Last interaction`, counts relative time, survives a renderer reopen within ten minutes, ignores unchanged/failed requests, disappears at ten minutes, and no frame-age badge covers the preview.
- [ ] Draw a mask over readable text; confirm `look()`, `screen://current`, and the audit thumbnail all show black pixels.
- [ ] Draw two highlights, label one, and confirm the preview shows legible yellow badges 1 and 2; deleting the first must renumber the second to 1.
- [ ] Capture a tall window such as 1280×1392 at constrained app height; confirm the whole frame is visible with side space and both editable highlight outlines and redaction boxes coincide with their model-baked pixels on every edge.
- [ ] Move one mask and one highlight from their circular top-left four-way handles; confirm their bodies do not drag, movement clamps at every source edge, and reselect/restart preserves the new coordinates.
- [ ] Resize one mask and one highlight from top, right, bottom, and left; confirm the opposite edge stays fixed, no edge crosses through the rectangle, and the minimum remains usable.
- [ ] Drag top-left, top-right, bottom-right, and bottom-left on both annotation types; confirm each overhanging corner target changes both adjacent sides, keeps the opposite corner fixed, clamps both axes independently, and uses the matching diagonal cursor.
- [ ] While drawing each annotation type, establish a visible draft, hold Ctrl, and move the pointer; confirm the draft translates without changing size, stays in bounds, and resumes sizing without a jump after Ctrl is released.
- [ ] Focus a highlight label next to its move handle, then resize from its top edge and both top corners; confirm the input, badge, Move/Delete circles, side targets, and surrounding corner targets remain independently reachable at normal and small sizes.
- [ ] Confirm changed and unchanged `look()` metadata plus `screen://current` `_meta` report the same badge numbers, labels, and returned-image pixel geometry; `describe_source` must report source-pixel geometry and `highlights: []` when empty.
- [ ] Start `wait_for_change` on a static frame, add a highlight, and confirm one changed image arrives within the next poll.
- [ ] Put a highlight over a redaction mask; confirm the masked interior remains black in preview, `look()`, resource, and audit thumbnail.
- [ ] Restart and reselect the source; confirm its frame policy, masks, and highlights return.
- [ ] Without entering an add mode, remove a persisted mask and highlight through their always-visible X controls; reselect and restart to confirm both removals persist.
- [ ] Confirm Add redaction/Add highlight are mutually exclusive, Escape exits drawing, idle rectangle bodies remain inert while explicit move/resize controls work, and overlapping delete controls remain reachable.
- [ ] Switch Access mode through Off, Read-only, and Interactive; confirm the panel, header chip, status, tray icon, and tooltip always agree.
- [ ] From Off, confirm `describe_source`, `look`, `wait_for_change`, `screen://current`, OCR, enumerate, read, click, type, and local preview all fail with `capture_stopped` while the MCP client remains connected.
- [ ] Switch Off to Read-only and confirm view calls resume without control. Press STOP from Interactive, then Resume in the window and tray; confirm both aliases also return to Read-only.
- [ ] Hide ScreenMCP to tray in Read-only, issue a coordinate `click`, and confirm the window opens with client/action/source and no target payload. Approve; confirm the window hides again, the same MCP call succeeds, and the mode/tray become Interactive.
- [ ] Repeat a Read-only `type_text` request and inspect the dialog, renderer events, error copy, and audit row; none may contain the typed string, while the audit target contains only `[redacted N chars]`.
- [ ] Deny one write and let another reach the 120-second timeout; both must remain Read-only, return `control_not_armed`, close the prompt, and perform no UIA/SendInput effect.
- [ ] While a write prompt is open, separately test MCP cancellation, source change/clear, active-dialog switch, STOP, and quit. Each must dismiss the prompt and make a later stale approval incapable of arming or input.
- [ ] Start two blocked writes for one source, cancel one, then approve. Confirm one prompt, no effect from the cancelled call, and successful continuation only for the live call.
- [ ] In Settings → App behavior, confirm Access mode default offers only Off and Read-only, defaults to Read-only, applies only after restart, and never changes the current mode.
- [ ] Select a Windows application parent, open a modal partly outside it, and confirm default-on Follow active dialogs replaces the preview/source label with the complete modal. Close it and confirm the parent returns; disable the setting and confirm another modal is not followed.
- [x] On the 2026-07-16 Windows dev machine, a real Total Commander copy dialog omitted from Electron enumeration followed through the production `CaptureStream`/`CaptureController` path as `Total Commander › Total Commander`; its exact non-black frame was 540×188 with no monitor/background pixels.
- [ ] Start `wait_for_change`, press STOP, and confirm it fails promptly without a final image or tray flash.
- [ ] Close the window; confirm it hides to tray, shows the first-run notice once, and can be reopened.

## Windows

- [x] Real monitor capture produced and decoded a 960×540 JPEG on Windows 11 during implementation on 2026-07-15.
- [x] Three real Rectangle overlays opened; a 520×340 DIP drag produced an exact 520×340 non-black region frame.
- [x] A real MCP `look()` and `screen://current` matched the UI's 1568×858 JPEG; resource metadata included numeric `frame_age_ms` and boolean `nearly_black`.
- [ ] Test Rectangle and Window across 100%, 125%, 150%, and 200% display scaling where hardware permits.
- [ ] Minimize a captured window; confirm unavailable/stale state is visible, then restore it and confirm freshness resumes.
- [ ] Verify tray icon size and disconnected/connected/capturing colors at 100% and 200% scaling.
- [ ] Test a UWP window and record whether suspension freezes frames.
- [x] On the 2026-07-15 Windows dev machine, the koffi COM worker enumerated the real taskbar (30 controls) with RuntimeId and physical bounds.
- [x] A temporary WinForms window exposed an edit and button; ValuePattern SetValue/read-back and Invoke both succeeded without cursor movement.
- [x] Four batches of 100 RuntimeId re-resolves plateaued after worker/JIT warm-up (RSS deltas: +45.2 MB, +5.5 MB, +3.7 MB, -2.8 MB).
- [x] Bundled English tesseract data recognized `ScreenMCP Save` with two plausible payload-pixel word boxes.
- [ ] Start once with each supported access default. Off must block before the window/host is usable; Read-only must serve view calls. A legacy `control.enabled=true` or invalid `accessModeDefault=interactive` must start Read-only.
- [ ] Select a window, switch the Access mode toggle to Interactive, and confirm the renderer chip plus tray icon/tooltip turn amber; switching back to Read-only clears both.
- [ ] With a source selected, switch directly from Off to Interactive. Confirm it resumes and arms together. Repeat without a source and on an unsupported platform; the failed transition must remain Off.
- [ ] Verify source change/clear, Off/STOP, quit, and restart each require a new interaction grant. Window blur and idle time must not revoke it.
- [ ] Arm the parent, open its modal, then request a control action. Confirm the source switches first, Interactive is revoked, no effect occurs, and a fresh grant controls only the dialog. Closing it must revoke again before restoring parent control.
- [ ] Hide the app to tray, press ScrollLock and drag a region, then Shift+ScrollLock and pick a window; each selection applies without the main window appearing. Rebind and disable both keys in Settings → Shortcuts.
- [ ] From an MCP client, run all four control tools against Notepad: enumerate, read, Invoke/coordinate click, SetValue/append/submit.
- [ ] Mask text and OCR that region; masked words must not return. Then read an accessible element and confirm the documented UIA mask bypass.
- [ ] On the real three-monitor mixed-DPI layout, coordinate-click the center and edges of each selected monitor/region and confirm no cross-source click.
- [ ] Try an element crossing the selected window edge and an out-of-range payload point; both must fail `out_of_bounds` before cursor/input changes.
- [ ] Press STOP during an action and confirm it returns `capture_stopped`, remains disarmed after resume, and records a failed audit row.
- [ ] Confirm a type audit row contains `[redacted N chars]` and never the typed string.
- [ ] Force the selected HWND out of the foreground after UIA SetFocus; append and submit must return `out_of_bounds` without sending text or Enter.
- [ ] Open an audit thumbnail by mouse and keyboard; verify the fitted image/metadata, Escape/backdrop/X close, focus restoration, missing-file state, and an old 320×200 file.
- [ ] Try an elevated window and a canvas/Chromium target; verify clean limitations and coordinate/OCR fallback behavior.

## macOS

- [ ] With a fresh user, request Screen Recording, grant it, relaunch from the app, and capture successfully.
- [ ] Deny access; confirm the button opens the Screen Recording settings pane.
- [ ] Install the unsigned DMG, run `xattr -cr /Applications/ScreenMCP.app`, and confirm launch.
- [ ] Confirm the colored non-template tray states remain legible in light and dark menu bars.
- [ ] Test picker overlays on a secondary Space and above a fullscreen application; record compositor limitations.

## Linux X11

- [ ] Run the Xvfb CI capture test and confirm a non-black, decodable JPEG with plausible dimensions.
- [ ] On a desktop session, test monitor/window/region selection and an AppIndicator-capable tray.

## Linux Wayland

- [ ] On GNOME and KDE, confirm the app shows no fake custom source tools and the portal copy is accurate.
- [ ] Select a source once; call `look()` repeatedly and confirm the portal is not reopened while the stream remains active.
- [ ] Clear the source and restart the app; confirm the portal opens again and the limitation matches the documentation.
