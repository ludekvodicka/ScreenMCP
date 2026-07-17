# Platform notes

## Windows

Whole-screen choices come from Electron `desktopCapturer`. Rectangle selection uses one transparent overlay per display. Window hover combines Electron capture ids with front-to-back HWND metadata from `main/native-window-enum.ts`; physical native bounds are converted to Electron DIP with `screenToDipRect` for mixed-scale desktops. The native filter keeps visible application main windows even while an owned modal temporarily disables them, preventing hit testing from falling through to an occluded window underneath. The picker snapshots z-order before it creates its overlays and preserves that order while refreshing metadata, because overlay activation can reorder inactive application windows. Hidden, cloaked, tool, child, zero-size, and transient owned windows remain excluded.

After selection, default-on [active modal following](window-dialog-following.md) detects an enabled
same-process owned popup while that parent is disabled and switches the one stream directly to it. The
full dialog remains visible outside parent bounds. Settings can disable following; modeless popups and
unrelated owned popups remain unfollowed. A validated modal omitted from Electron's enumeration uses a
direct HWND source fallback; if Chromium rejects that capture, ScreenMCP keeps the prior valid stream.

Windows may freeze a selected minimized, protected, or suspended window. A selected stream remains open; `frameAgeMs` comes from video-frame callbacks and the UI warns after two seconds without a new frame. Restoring the window normally resumes fresh frames. Some UWP applications can remain frozen while suspended.

Tray icons render at 32 physical pixels with scale factor 2, yielding the expected 16 DIP size.

## macOS

Screen Recording is a TCC permission. ScreenMCP treats the states explicitly:

- `not-determined`: a capture enumeration triggers the native prompt.
- `denied`, `restricted`, or `unknown`: the UI opens Privacy & Security → Screen Recording.
- after the prompt: ScreenMCP marks the process restart-required without re-querying the stale in-process TCC state.
- `granted`: source enumeration is enabled.

The relaunch action calls `app.relaunch()` and quits the current process. Version 0.1 is unsigned; after installing a downloaded build, remove quarantine with:

```sh
xattr -cr /Applications/ScreenMCP.app
```

Recent macOS versions may ask for Screen Recording access again periodically. The v1 tray icon is deliberately colored and non-template so disconnected, connected, and capturing states remain distinguishable.

## Linux X11

X11 uses the same Rectangle, Window, and Whole screen actions as Windows. The automated capture test starts Electron under Xvfb, renders a visible window, calls the real MCP `look()` pipeline, and decodes the resulting JPEG.

The tray requires a desktop with StatusNotifierItem/AppIndicator support. On desktops without it, keep the main window open or launch it again to focus the existing single instance.

## Linux Wayland

Wayland does not expose trustworthy application-owned global source geometry. ScreenMCP replaces the custom actions with the desktop portal picker. The selected `getDisplayMedia` stream stays alive, so `look()` and `wait_for_change()` do not reopen the picker.

Electron does not expose the XDG ScreenCast portal `restore_token` through `desktopCapturer` or `setDisplayMediaRequestHandler`. Consequently, v0.1 cannot restore a grant after clearing the source or restarting the app; the system picker opens again. No persistence is claimed in the UI.

The app enables Chromium's PipeWire WebRTC capture feature on Linux. Portal behavior still depends on the compositor, desktop portal implementation, and PipeWire installation.
