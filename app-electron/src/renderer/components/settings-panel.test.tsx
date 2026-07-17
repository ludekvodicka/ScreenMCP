import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppSettings, UpdateStatus } from '../../shared/contracts'
import { SettingsPanel } from './SettingsPanel'

const settings: AppSettings = {
  closeAction: 'tray',
  accessModeDefault: 'read-only',
  followActiveDialogs: true,
  trayNoticeShown: false,
  hashThreshold: 4,
  jpegQuality: 80,
  maxLongSide: 1568,
  format: 'jpeg',
  auditThumbnailRetention: 100,
  sourcePolicies: {},
  masks: {},
  highlights: {},
  updates: { autoCheck: true, checkIntervalMinutes: 120 },
  shortcuts: { pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' },
}

const updateStatus: UpdateStatus = {
  channel: 'none',
  reason: 'Manual updates',
  autoCheck: true,
  checkIntervalMinutes: 120,
  running: '0.1.0',
  phase: 'idle',
  progress: null,
  lastError: null,
  lastCheckAt: null,
  lastCheckOutcome: null,
  pendingVersion: null,
  snoozedUntil: 0,
}

describe('SettingsPanel access default', () => {
  it('offers Off and Read-only without a persistent Interactive grant', () => {
    const html = renderToStaticMarkup(<SettingsPanel settings={settings} selection={null} updateStatus={updateStatus} onChange={() => undefined} onOpenUpdates={() => undefined} />)
    expect(html).toContain('Access mode default')
    expect(html).toContain('<option value="read-only" selected="">Read-only</option>')
    expect(html).toContain('<option value="off">Off</option>')
    expect(html).not.toContain('<option value="interactive">')
    expect(html).toContain('applies after the next app start')
    expect(html).toContain('Follow active dialogs')
    expect(html).toContain('type="checkbox" checked=""')
  })
})
