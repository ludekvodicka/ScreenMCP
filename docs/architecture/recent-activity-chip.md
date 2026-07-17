# Recent activity chip

## Decision

The application header shows a temporary audited-activity chip for ten minutes after the model last
successfully received a screenshot or completed an interactive-control request. The chip is a recent
signal only; the Audit tab remains the durable history.

The former preview overlay based on `PreviewFrame.frameAgeMs` is not used for this purpose. That value
measures the age of the capture stream's latest OS video-frame callback and remains available in capture
metadata for diagnosing frozen or minimized sources. It does not identify when the model last looked.

## Semantics

| Audit entry | Header result |
| --- | --- |
| Successful `look`, `resource`, or changed `wait_for_change` with an image | `Last screenshot · now/3s ago/2m ago` |
| Successful `enumerate`, `read`, `click`, or `type` | `Last interaction · now/3s ago/2m ago` |
| Unchanged capture check | No update |
| Failed capture or control request | No update |
| Latest qualifying entry is at least ten minutes old | No chip |

The newest qualifying timestamp wins across both categories. Seconds are shown below one minute and
whole minutes after that. The chip disappears at ten minutes rather than occupying permanent header
space.

## Data flow and lifecycle

`AuditLog.append()` publishes each completed `AuditEntry` through the existing `audit:entry` renderer
stream. `RecentActivityChip` subscribes to that stream and seeds itself from `listAudit(200)` so reopening
or reloading the renderer can restore a still-recent event. Timestamp comparison prevents a delayed
history response from replacing a newer live event.

The renderer preview is deliberately excluded: its 750 ms refresh is local, non-audited, and never means
that an MCP client received an image. No recent-activity state is persisted separately, and no IPC or
audit schema duplicates the existing log.

## Key files and constraints

- `app-electron/src/renderer/components/RecentActivityChip.tsx` owns classification, race-safe merge,
  relative formatting, timer, and rendering.
- `app-electron/src/renderer/App.tsx` places the chip in the upper header.
- `app-electron/src/main/audit-log.ts` remains the single activity timestamp source.
- Header CSS must preserve capture status, access mode, updates, and STOP at the 900 px minimum width.
- Unknown audit actions and activity kinds throw instead of silently falling into an existing category.
