# Releases and updates

## Public source boundary

SVN is the internal source of truth. Public GitHub commits are constructed from `svn export -r BASE`,
not the working copy. Internal AI workflow files, private owner tooling, generated instructions,
credentials, and build output are stripped. The resulting tree must pass path assertions, an owner
token scan, and gitleaks before a commit object is created. A human reviews that exact object; a push
is rejected if `origin/main` moved after review. The pre-push hook gates the exact SHA again.

This projection model means a merged public pull request must be backported into SVN before the next
publish.

## Build and release flow

`ci.yml` runs the same source checks on Windows, macOS, and Linux, plus the Linux/X11 capture smoke and
a full-history secret scan. `release.yml` has two entry points:

- `workflow_dispatch` packages native artifacts on all three systems and stores workflow artifacts.
  It does not create a tag or GitHub Release.
- a `vX.Y.Z` tag must match every synchronized package version. All native builders must succeed
  before a draft Release receives installers, updater metadata, blockmaps, `register.mjs`, and SHA256
  checksums.

Builders always use `--publish never`; only the final release job uploads assets. This prevents a
partially successful matrix from exposing an incomplete update feed.

CI and release builders pin Node 24.22.1 independently of Electron's embedded Node. A build-host
Node update does not update the packaged runtime; that requires a supported Electron release.

The third-party inventory lists platform-independent runtime packages from pnpm's installed tree.
Optional sharp, resvg and koffi bindings differ by operating system, so their declared licenses are
validated against the native-family notices instead of inserting host-specific package names into
the shared document. An unexpected binding license fails the check. This keeps the same notice
valid on Windows, macOS and Linux while retaining the actual license files in packaged dependencies.

## Runtime matrix

| Runtime | Mode | Behavior |
| --- | --- | --- |
| Development | Off | No updater access; dev builds must not consume the production feed. |
| Installed Windows (NSIS) | Automatic | Checks GitHub Releases and downloads a new version in the background. |
| Packaged Linux (AppImage, deb) | Automatic | Same as installed Windows, from the published Linux feed. |
| Windows Portable | Notify | Checks only; the app shows the new version and links to its release page. |
| Unsigned macOS | Notify | Checks only; automatic updates require a signed and notarized application. |
| Build without `app-update.yml` | Off | The first check reports a missing feed and stops the schedule. |

The mode is derived from runtime facts and cannot be changed in settings. Settings expose only
automatic-check enablement and interval; both apply after the next start.

## Update flow

The updater comes from the shared `shared/electron/autoUpdate` module (main process, preload bridge,
renderer hook) and `shared/electron/autoUpdateWidgets` (the header indicator and the update panel).
Main owns one observable state and broadcasts every change to all windows; the renderer reaches it
through `window.screenmcp.autoUpdate`.

`idle → checking → current | downloading → ready → installing` in automatic mode;
`checking → available` in notify mode; `failed` and `off` from any step that cannot continue.

- **No consent prompt and no snooze:** in automatic mode a found release downloads in the background.
  ScreenMCP keeps serving the current source during the download.
- **No automatic restart:** `ready` stays until the user chooses Restart and install (header indicator,
  update panel, or tray menu) or until a later normal quit installs the staged update.
  ScreenMCP never restarts based on MCP client activity and never arbitrarily disconnects clients.
- **Quit lifecycle:** the first `will-quit` pass waits for MCP/capture cleanup and then calls
  `app.quit()` again; it never uses `app.exit()`, so electron-updater receives the normal quit lifecycle.
  When the state becomes `installing`, close-to-tray is released so the installer can quit the app.
- **Failures:** a failed background check keeps the previous state and is only logged (offline is not an
  update failure). A failed manual check or download shows `failed` with a retry.
- **Release page:** main composes the URL (`/releases/tag/vX.Y.Z`, or the release list) and opens it only
  for `https://github.com`; the renderer never supplies a URL.
- **Notification:** when an update becomes `ready`, ScreenMCP shows one OS notification per release.

Checks begin 45 seconds after startup and repeat every 120 minutes by default. Updater warnings and
state changes append to `~/.screenmcp/update-log.jsonl`, trimmed from 512 KiB to roughly 256 KiB on
whole-line boundaries.

## Signing follow-up

Current artifacts and release notes must stay explicit that binaries are unsigned. Enabling macOS
automatic updates requires an Apple signing identity, notarization in the native builder, and a
deliberate runtime-matrix change. Windows signing should likewise be added without weakening the
version, feed, checksum, or draft-release gates.
