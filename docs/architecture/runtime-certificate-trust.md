# Runtime certificate trust

## Decision

ScreenMCP 0.2.3 pins Electron 43.8.4 in the root manifest and pnpm lockfile. Electron 43.8.4
embeds Node 24.22.1, the October Node security release, with Chromium 150.0.7871.250 unchanged
from 43.8.3. It follows the validated 0.2.1 / Electron 43.8.1 CA repair and the interim 0.2.2 /
Electron 43.8.3 Chromium-stack update. No application certificate override or shared updater
change is required. CI's Node 24.22.1 pin updates the build host only.

Node 24.22.1 ships the SubjectPublicKeyInfo blocklist itself. Electron 43.8.4 therefore replaces
its own Node patch with `tls_adapt_the_upstream_spki_blocklist_for_electron.patch`, which keeps
the same eight compiled-in keys and adds only a BoringSSL build fix and test hooks. Its other
`patches/node` changes are rebases. The packaged regression check below still applies, because
the Node client enforcement now comes from different code.

Electron's [upstream fix](https://github.com/electron/electron/pull/55126),
[backported to 43](https://github.com/electron/electron/pull/55130), enforces a compiled SPKI
blocklist in Node SecureContexts and adds Chromium blocklist entries. The affected emSign root
can remain in `tls.rootCertificates` while actual connections reject the compromised chain.
Extracting that bundle and running OpenSSL verification does not exercise Electron's blocklist.

## Clients and boundaries

| Client | Application entry point | Trust implementation |
| --- | --- | --- |
| Update checks and downloads | `AutoUpdateMain` in `app-electron/src/main/index.ts`, shared `autoUpdate` | `electron-updater` 6.8.9 `ElectronHttpExecutor`, `electron.net.request`, `electron-updater` session partition |
| Chromium default session | Main and capture BrowserWindows | Electron/Chromium certificate validation; normal UI loads bundled files |
| Node HTTPS and fetch | Embedded main-process APIs | Electron's patched Node SecureContext; no direct production outbound call found in application source |
| MCP server | `app-electron/src/main/mcp-host.ts` | Inbound loopback HTTP, Host/Origin/bearer controls; no remote TLS connection |
| Release page links | Shared updater IPC, `shell.openExternal` | External browser; outside the bundled runtime |

OCR workers use packaged assets. Native capture, IPC, source selection, access modes and shared
automatic-update lifecycle retain their existing implementation. The app does not change Windows
trust, firewall settings, or the agent host's Node runtime.

## Packaged regression check

Build sequentially, then run the check against the exact candidate executable:

```powershell
pnpm run check
pnpm exec electron-builder --win --x64 --config electron-builder.yml --config.directories.output=release/electron-0.2.3 --publish never
pnpm run test:runtime-trust release/electron-0.2.3/win-unpacked/ScreenMCP.exe .aidocs/temp/runtime-check.json
pnpm run release:smoke win release/electron-0.2.3
```

`scripts/smoke-runtime-trust.mjs` starts a new packaged process with isolated application, Electron,
Claude and Codex profile paths. It disables scheduled update checks in that test profile and opens
an ephemeral loopback Node inspector. The runner resolves dependencies from the candidate's own
`app.asar`, exercises HTTPS, fetch, the default Chromium session and the actual updater executor,
then closes only that process. It does not modify the executable or archive.

Each client must reject all twelve hosts from the
[incident test set](https://emudhra.we-have-a-problem.com/) and return HTTP 200 for both
`example.com` and `github.com`. Network failures, including `EACCES` and timeouts, fail the check.
Only explicit certificate rejection errors count. The JSON report identifies the executable,
package/runtime versions, each host/client result and overall verdict.

The same run captures a solid-color test window through the application's preload API and native
capture pipeline, decodes the preview with packaged sharp and checks the center pixel. It also
verifies loopback health access: unauthenticated 401, authenticated browser-origin 403, authenticated
non-browser 200. No desktop screenshot or endpoint credential is included in the report.

## Constraints

The live test depends on the public incident hosts remaining available. Root inventory and offline
OpenSSL results are supporting evidence only. A blocked or expired public test needs explicit
investigation and cannot be reported as a pass. Never use `--use-openssl-ca`, disable TLS
verification, or alter the firewall to make the check pass.

The local Windows result does not establish macOS/Linux packaging, installation over an existing
release, or public release availability. Publication and activation follow
[releases and updates](releases-and-updates.md), including human SVN review and separate public
publication authority. A candidate build never authorizes restarting an active capture/MCP session.
