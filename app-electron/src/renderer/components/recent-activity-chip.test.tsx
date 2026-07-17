import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '../../shared/contracts'
import {
  classifyRecentActivity,
  mergeRecentActivity,
  newestRecentActivity,
  RecentActivityView,
  recentActivityText,
  RECENT_ACTIVITY_LIFETIME_MS,
  type RecentActivity,
} from './RecentActivityChip'

const screenshotActions = ['look', 'wait_for_change', 'resource'] as const
const interactionActions = ['enumerate', 'read', 'click', 'type'] as const

describe('recent activity classification', () => {
  it('classifies every successful image-bearing audit action as a screenshot', () => {
    for (const action of screenshotActions)
      expect(classifyRecentActivity(entry(action, { changed: true }))).toEqual({ kind: 'screenshot', timestamp: 1_000 })
  })

  it('ignores unchanged, empty, and failed capture outcomes', () => {
    for (const action of screenshotActions) {
      expect(classifyRecentActivity(entry(action, { changed: false }))).toBeNull()
      expect(classifyRecentActivity(entry(action, { changed: null }))).toBeNull()
      expect(classifyRecentActivity(entry(action, { changed: true, error: 'capture failed' }))).toBeNull()
    }
  })

  it('classifies every successful control action as interaction and ignores failures', () => {
    for (const action of interactionActions) {
      expect(classifyRecentActivity(entry(action, { changed: null }))).toEqual({ kind: 'interaction', timestamp: 1_000 })
      expect(classifyRecentActivity(entry(action, { changed: null, error: 'blocked' }))).toBeNull()
    }
  })

  it('throws for unknown runtime action and capture outcome values', () => {
    expect(() => classifyRecentActivity({ ...entry('look'), action: 'future' } as unknown as AuditEntry)).toThrow('Unknown audit action')
    expect(() => classifyRecentActivity({ ...entry('look'), changed: undefined } as unknown as AuditEntry)).toThrow('Unknown capture outcome')
  })

  it('keeps the newest qualifying event across delayed history and live data', () => {
    const live: RecentActivity = { kind: 'interaction', timestamp: 3_000 }
    const history: RecentActivity = { kind: 'screenshot', timestamp: 2_000 }
    expect(mergeRecentActivity(live, history)).toBe(live)
    expect(mergeRecentActivity(history, live)).toBe(live)
    expect(mergeRecentActivity(live, { kind: 'screenshot', timestamp: 3_000 })).toBe(live)
    expect(newestRecentActivity([
      entry('type', { timestamp: 4_000, changed: null, error: 'blocked' }),
      entry('look', { timestamp: 2_000, changed: true }),
      entry('click', { timestamp: 3_000, changed: null }),
    ])).toEqual(live)
  })
})

describe('RecentActivityView', () => {
  it('renders screenshot age as now, seconds, and minutes', () => {
    const activity: RecentActivity = { kind: 'screenshot', timestamp: 1_000 }
    expect(renderToStaticMarkup(<RecentActivityView activity={activity} now={1_000} />)).toContain('Last screenshot · now')
    expect(renderToStaticMarkup(<RecentActivityView activity={activity} now={4_400} />)).toContain('Last screenshot · 3s ago')
    expect(renderToStaticMarkup(<RecentActivityView activity={activity} now={121_000} />)).toContain('Last screenshot · 2m ago')
  })

  it('renders interaction and disappears at ten minutes', () => {
    const activity: RecentActivity = { kind: 'interaction', timestamp: 0 }
    expect(renderToStaticMarkup(<RecentActivityView activity={activity} now={RECENT_ACTIVITY_LIFETIME_MS - 1} />)).toContain('Last interaction · 9m ago')
    expect(renderToStaticMarkup(<RecentActivityView activity={activity} now={RECENT_ACTIVITY_LIFETIME_MS} />)).toBe('')
    expect(renderToStaticMarkup(<RecentActivityView activity={null} now={0} />)).toBe('')
  })

  it('clamps future timestamps to now and throws for an unknown activity kind', () => {
    expect(recentActivityText({ kind: 'screenshot', timestamp: 2_000 }, 1_000)).toBe('Last screenshot · now')
    expect(() => recentActivityText({ kind: 'future', timestamp: 0 } as unknown as RecentActivity, 0)).toThrow('Unknown recent activity')
  })
})

function entry(action: AuditEntry['action'], overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `${action}-1`,
    timestamp: 1_000,
    client: 'codex',
    action,
    source: 'Editor',
    sourceKind: 'window',
    changed: action === 'look' || action === 'wait_for_change' || action === 'resource' ? true : null,
    hash: null,
    bytes: null,
    thumbnail: null,
    error: null,
    ...overrides,
  }
}
