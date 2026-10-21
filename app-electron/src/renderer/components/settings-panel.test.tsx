import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DtoAutoUpdateStatus } from '../../../../shared/electron/autoUpdate/common/autoUpdate.dto'
import { AutoUpdateView } from '../../../../shared/electron/autoUpdate/common/autoUpdateView'
import type { AutoUpdateController } from '../../../../shared/electron/autoUpdate/renderer/useAutoUpdate'
import type { AppSettings } from '../../shared/contracts'
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

const updateStatus: DtoAutoUpdateStatus = { running: '0.1.0', mode: 'automatic', releasePage: true, state: { kind: 'current', checkedAt: 1 } }

const update: AutoUpdateController = {
  status: updateStatus,
  view: AutoUpdateView.describe(updateStatus),
  check: () => undefined,
  install: () => undefined,
  openReleasePage: () => undefined,
}

describe('SettingsPanel access default', () => {
  it('offers Off and Read-only without a persistent Interactive grant', () => {
    const html = renderToStaticMarkup(<SettingsPanel settings={settings} selection={null} update={update} onChange={() => undefined} onOpenUpdates={() => undefined} />)
    expect(html).toContain('Access mode default')
    expect(html).toContain('<option value="read-only" selected="">Read-only</option>')
    expect(html).toContain('<option value="off">Off</option>')
    expect(html).not.toContain('<option value="interactive">')
    expect(html).toContain('applies after the next app start')
    expect(html).toContain('Follow active dialogs')
    expect(html).toContain('type="checkbox" checked=""')
  })
})

describe('SettingsPanel updates', () => {
  it('keeps the check schedule settings and offers no snooze', () => {
    const html = renderToStaticMarkup(<SettingsPanel settings={settings} selection={null} update={update} onChange={() => undefined} onOpenUpdates={() => undefined} />)
    expect(html).toContain('Check automatically after startup')
    expect(html).toContain('<option value="120" selected="">Every 2 hours</option>')
    expect(html).toContain('Up to date')
    expect(html).toContain('Check now')
    expect(html).toContain('Open GitHub Releases')
    expect(html).not.toMatch(/snooze|Later/i)
  })
})
