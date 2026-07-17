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

## Runtime matrix

| Runtime | Channel | Reason |
| --- | --- | --- |
| Development | Manual/disabled | Dev builds must not consume the production feed. |
| Installed Windows (NSIS) | GitHub Releases | Supported by electron-updater. |
| Windows Portable | Manual | Self-replacement of the portable executable is not attempted. |
| Packaged Linux | GitHub Releases | Uses the published Linux feed. |
| Unsigned macOS | Manual | Automatic updates require a signed and notarized application. |

The update channel is derived from runtime facts and cannot be changed in settings. Settings expose
only automatic-check enablement and interval.

## State machine and consent

Main owns one observable state:

`idle → checking → available → downloading → ready → installing`

Failures enter `error`. Background check failures return quietly to idle after logging; manual errors
stay visible. A check never downloads. Only the Download button calls the updater download method.
After download, `ready` remains stable until Restart & install or a later normal application quit. The
first `will-quit` pass waits for MCP/capture cleanup and then calls `app.quit()` again; it never uses
`app.exit()`, so electron-updater receives the normal quit lifecycle and can apply the staged update.
ScreenMCP does not restart based on MCP client activity and never arbitrarily disconnects clients.

Checks begin 45 seconds after startup and repeat every 120 minutes by default. Available updates can
be snoozed for 1, 2, 4, or 12 hours; manual checks bypass snooze. Decisions and diagnostics append to
`~/.screenmcp/update-log.jsonl`, trimmed from 512 KiB to roughly 256 KiB on whole-line boundaries.

## Signing follow-up

Current artifacts and release notes must stay explicit that binaries are unsigned. Enabling macOS
automatic updates requires an Apple signing identity, notarization in the native builder, and a
deliberate runtime-matrix change. Windows signing should likewise be added without weakening the
version, feed, checksum, or draft-release gates.
