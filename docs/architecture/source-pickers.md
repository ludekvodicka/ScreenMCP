# Desktop source pickers

## Decision

Source selection has three explicit paths under **Choose one source**:

1. **Rectangle** opens one transparent overlay per display and accepts a meaningful drag on one display.
2. **Window** opens the same overlays, highlights the frontmost capturable window under the pointer,
   and selects it on click.
3. **Whole screen** opens an in-app, monitor-only thumbnail dialog and selects one complete display.

The old always-visible monitor/window grid and nested region editor are removed. The Source tab always
renders a separate **Visible to model** panel, including an explicit no-pixels state before selection.

## Ownership and lifecycle

`DesktopSourcePicker` in `app-electron/src/main/desktop-source-picker.ts` owns at most one Rectangle or
Window session. It hides the main window, creates one sandboxed and capture-protected `BrowserWindow`
per `screen.getAllDisplays()` entry, and restores the main window in `finally`. Escape, right-click,
display-topology changes, and app shutdown cancel the session. Cancel and selection failures preserve
the previous stream.

The overlay renderer is isolated behind `preload/picker.ts`. Its API can publish pointer positions,
complete one selection, cancel, and receive exhaustive config/target/error states; it has no Node or
Electron access. Pointer updates are limited to one per animation frame.

Whole-screen selection does not create desktop overlays. The renderer requests monitor sources only
when its dialog opens, displays Electron-generated previews, and calls the existing capture controller
for the chosen monitor.

## Rectangle coordinates

Overlay bounds and pointer positions are display-local DIP values. A drag smaller than 12 × 12 DIP is
ignored. A valid rectangle is normalized by that overlay's width and height, then converted only after
`CaptureStream.start()` reports the monitor stream's real pixel dimensions. The stored selection is an
integer source-space crop. One rectangle cannot cross or stitch displays.

This normalized boundary avoids assuming that display DIP size equals capture pixels on Retina,
rotated, or mixed-scaling desktops.

## Window matching

Electron exposes capturable window ids but not bounds. On macOS and X11, `get-windows` supplies
front-to-back native window ids, owner PIDs, and bounds. Windows uses
`main/native-window-enum.ts`, which traverses HWND z-order directly through `koffi`. It excludes hidden,
cloaked, tool, child, zero-size, and transient owned windows, but deliberately retains a visible main
HWND that an owned modal has disabled; enabled state is not a capture-availability signal.

ScreenMCP intersects native metadata with Electron capture sources by native id, excludes its own PID,
and snapshots the resulting z-order before hiding the main window or showing picker overlays. Refreshes
replace current labels, bounds, and availability but restore surviving targets to that snapshot order;
overlay activation therefore cannot promote a previously covered window in the hit test. Windows HWND
values are normalized across signed and unsigned 32-bit representations. Interactive control directly
re-inspects the active HWND, so default-on [modal following](window-dialog-following.md) can use an owned
dialog without exposing that dialog as a separate initial picker target.

On Windows, native physical rectangles are converted with `screen.screenToDipRect`; X11 converts both
corners through Electron; macOS coordinates are already suitable for the overlay. Candidate metadata
refreshes while the picker is open, and a click refreshes once more before capture so a vanished target
produces an error instead of a title-based guess. Targets first seen after the snapshot are appended.

## Constraints

- Wayland cannot expose global window bounds or trustworthy application-owned overlays, so it keeps the
  system portal picker instead of these three custom actions.
- A region is limited to one display because the capture and privacy model owns exactly one stream.
- macOS fullscreen apps and Spaces can outrank Electron overlays; this remains a manual platform check.
- `get-windows` contains platform-native artifacts for macOS/X11 and `koffi` supplies Windows HWND
  enumeration. Both remain external to the Vite main bundle and ASAR-unpacked for packaged builds.
