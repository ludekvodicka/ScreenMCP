# Privacy model

## Protected assets

- Pixels outside the source explicitly selected by the human
- Pixels covered by a redaction mask
- The bearer token in `endpoint.json`
- Local audit metadata and redacted thumbnails
- Human control over when capture is served
- Human control over whether the model may act on the selected source

## Trust boundaries

The Electron main process is trusted to enforce source, the three-state access model, masks, control arming, action scoping, and transport policy. Main UI,
capture worker, and picker overlay renderers are sandboxed with context isolation and no Node
integration; narrow preload APIs mediate IPC. MCP clients are local but not trusted until they present
the bearer token. A write request displays the client's self-reported label but does not authenticate it.

The selected desktop application and captured pixels are untrusted input. ScreenMCP never evaluates screen content as code.

## Controls

| Risk | Control |
| --- | --- |
| Remote access | Listener binds only to `127.0.0.1`; no LAN interface is opened. |
| Unauthenticated local request | Every health and MCP request requires the random bearer token; comparisons hash both values and use constant-time comparison. |
| Browser drive-by / DNS rebinding | Requests with an `Origin` header are rejected and Host is allowlisted to the active localhost port/name. |
| Unintended local client | The endpoint requires the random bearer token stored in the user's ScreenMCP state directory; client names are labels only. |
| Wrong source | Source choice is UI-only. MCP tools accept no source ID. |
| Unexpected popup capture | Default-on Windows dialog following stays inside the selected parent's same-process owned modal chain, requires a disabled parent, and can be disabled in Settings. If Electron omits that validated modal, only the internal follower may construct its exact HWND source; MCP and manual selection cannot supply arbitrary ids. |
| Continued capture | Off and STOP share one global gate checked before all tools/resources; clear source stops media tracks. |
| Sensitive subregion | Masks black raw pixels before every downstream operation. |
| Model-driven input | Interactive control is Windows-only and requires one explicit runtime grant bound to the current source. A Read-only click/type pauses while the human accepts or rejects that mode change. |
| Stale/wrong control target | Active dialogs refresh before control authorization; any parent/dialog switch revokes Interactive. Opaque UIA refs are freshly re-resolved once per operation; every element/coordinate is checked against the active source, and global keystrokes require its HWND to remain foreground immediately before injection. |
| Unattended control | Startup defaults only to Off or Read-only; a write prompt expires after 120 seconds and follows MCP abort; source changes, Off/STOP, and quit revoke interaction. An Interactive header chip and amber tray state remain visible while it is allowed. |
| Action forensics leaking secrets | Every control attempt is audited, but typed text is replaced with a character count and redacted placeholder. |
| Idle token use | dHash change gating returns no image when unchanged; bounded long-polling replaces tight loops. |
| Disk leakage | Raw frames are memory-only. Audit frames are post-redaction JPEGs capped at 960×600 and retention-limited. |
| Partial/corrupt settings | Endpoint and settings JSON use temporary files plus atomic rename. |

## Stored data

`~/.screenmcp/endpoint.json` contains the loopback URL, port, and bearer token. `settings.json` contains UI preferences, per-source frame policies, masks/highlights, the `followActiveDialogs` preference, and an Off or Read-only startup default. The current runtime mode, pending write request, followed HWND, logical parent, and Interactive access are never persisted. `audit/log.jsonl` contains request time, client label, action, source label/kind, hash, byte count, control target/method/outcome, and error. Raw typed text is never stored or sent to the write-request dialog. Redacted audit frames are separate JPEG files and can be opened from the local Audit tab.

`~/.screenmcp/skill-payloads` contains only bundled skill text and registration scripts, never the
endpoint token. Startup may create a `screenmcp` junction/symlink in a detected agent's personal
skills directory. ScreenMCP replaces only links that resolve back below its own payload root; existing
real directories and foreign links are untouched.

POSIX-capable systems create credential/settings files with mode `0600`. On Windows, inherited user-profile ACLs provide the effective boundary.

## Limitations

- Any local process running as the same OS user may be able to read `endpoint.json`; ScreenMCP does not claim protection from a fully compromised user session.
- MCP `clientInfo` is not a cryptographic identity. Two clients can report the same name shown in a write request or audit row.
- A malicious or compromised selected application controls its visible pixels and can show misleading content.
- Screen-capture APIs can return stale, black, or protected frames. Metadata and UI warnings expose this but cannot make protected content capturable.
- Chromium can reject or return a stale/protected frame even for a natively validated direct modal HWND. ScreenMCP then keeps the previous valid stream; it never expands to monitor capture.
- Audit metadata retains source labels, which can contain document or application names. Thumbnail retention does not delete JSONL metadata.
- Wayland's portal remains the final authority. ScreenMCP cannot restore portal grants across app restarts with Electron's current public API.
- UIA element reads return live accessibility text and do not pass through pixel redaction masks. Region OCR reads the redacted pixel payload and does honor masks.
- A normal process cannot inject into elevated windows. Custom-drawn and accessibility-disabled applications can expose incomplete element trees.

## Incident response

Select Off or press STOP first; both dismiss a pending write request, disarm control, and refuse every MCP screen/control operation while clients may remain connected. Then clear the source. Quit ScreenMCP to close the endpoint. Deleting `~/.screenmcp/endpoint.json` and restarting rotates a missing/invalid token.
