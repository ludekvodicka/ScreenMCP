import { useEffect, useState } from 'react'
import type { AuditEntry } from '../../shared/contracts'

export const RECENT_ACTIVITY_LIFETIME_MS = 10 * 60_000

export type RecentActivity =
  | { kind: 'screenshot'; timestamp: number }
  | { kind: 'interaction'; timestamp: number }

export function RecentActivityChip() {
  const [activity, setActivity] = useState<RecentActivity | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    const accept = (entry: AuditEntry): void => {
      const candidate = classifyRecentActivity(entry)
      if (!candidate) return
      setActivity(current => mergeRecentActivity(current, candidate))
      setNow(Date.now())
    }
    const unsubscribe = window.screenmcp.onAuditEntry(accept)
    void window.screenmcp.listAudit(200).then(entries => {
      if (!active) return
      setActivity(current => mergeRecentActivity(current, newestRecentActivity(entries)))
      setNow(Date.now())
    }).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (!activity) return
    const refresh = (): void => setNow(Date.now())
    refresh()
    const interval = setInterval(refresh, 1_000)
    const expiry = setTimeout(() => {
      setNow(Date.now())
      setActivity(current => current?.kind === activity.kind && current.timestamp === activity.timestamp ? null : current)
    }, Math.max(0, activity.timestamp + RECENT_ACTIVITY_LIFETIME_MS - Date.now()))
    return () => { clearInterval(interval); clearTimeout(expiry) }
  }, [activity])

  return <RecentActivityView activity={activity} now={now} />
}

export function RecentActivityView({ activity, now }: { activity: RecentActivity | null; now: number }) {
  if (!activity) return null
  const text = recentActivityText(activity, now)
  if (!text) return null
  return <span className={`recent-activity-chip activity-${activity.kind}`} title={new Date(activity.timestamp).toLocaleString()}><i />{text}</span>
}

export function classifyRecentActivity(entry: AuditEntry): RecentActivity | null {
  if (entry.error !== null) return null
  if (entry.action === 'look') return screenshotActivity(entry)
  else if (entry.action === 'wait_for_change') return screenshotActivity(entry)
  else if (entry.action === 'resource') return screenshotActivity(entry)
  else if (entry.action === 'enumerate') return { kind: 'interaction', timestamp: entry.timestamp }
  else if (entry.action === 'read') return { kind: 'interaction', timestamp: entry.timestamp }
  else if (entry.action === 'click') return { kind: 'interaction', timestamp: entry.timestamp }
  else if (entry.action === 'type') return { kind: 'interaction', timestamp: entry.timestamp }
  else throw new Error(`Unknown audit action: ${JSON.stringify(entry.action)}`)
}

export function mergeRecentActivity(current: RecentActivity | null, candidate: RecentActivity | null): RecentActivity | null {
  if (!candidate) return current
  if (!current || candidate.timestamp > current.timestamp) return candidate
  return current
}

export function newestRecentActivity(entries: readonly AuditEntry[]): RecentActivity | null {
  return entries.reduce<RecentActivity | null>((current, entry) => mergeRecentActivity(current, classifyRecentActivity(entry)), null)
}

export function recentActivityText(activity: RecentActivity, now: number): string | null {
  const age = recentActivityAge(activity.timestamp, now)
  if (!age) return null
  if (activity.kind === 'screenshot') return `Last screenshot · ${age}`
  else if (activity.kind === 'interaction') return `Last interaction · ${age}`
  else throw new Error(`Unknown recent activity: ${JSON.stringify(activity)}`)
}

function screenshotActivity(entry: AuditEntry): RecentActivity | null {
  if (entry.changed === true) return { kind: 'screenshot', timestamp: entry.timestamp }
  else if (entry.changed === false) return null
  else if (entry.changed === null) return null
  else throw new Error(`Unknown capture outcome: ${JSON.stringify(entry.changed)}`)
}

function recentActivityAge(timestamp: number, now: number): string | null {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) throw new TypeError('Recent activity timestamps must be finite')
  const age = Math.max(0, now - timestamp)
  if (age >= RECENT_ACTIVITY_LIFETIME_MS) return null
  if (age < 1_000) return 'now'
  if (age < 60_000) return `${Math.floor(age / 1_000)}s ago`
  return `${Math.floor(age / 60_000)}m ago`
}
