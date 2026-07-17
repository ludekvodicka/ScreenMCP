import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppSettings, HighlightRect } from '../shared/contracts'
import { SettingsStore } from './settings-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  delete process.env.SCREENMCP_HOME
})

describe('SettingsStore source privacy', () => {
  it('follows active dialogs by default and persists an explicit disable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const store = new SettingsStore()
    await store.load()
    expect(store.get().followActiveDialogs).toBe(true)
    await store.update({ followActiveDialogs: false })
    const restarted = new SettingsStore()
    await restarted.load()
    expect(restarted.get().followActiveDialogs).toBe(false)
  })

  it.each(['yes', 0, null, {}])('normalizes invalid dialog-following value %j to enabled', async value => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ followActiveDialogs: value }))
    const store = new SettingsStore()
    await store.load()
    expect(store.get().followActiveDialogs).toBe(true)
  })

  it('defaults startup access to Read-only and persists Off', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const store = new SettingsStore()
    await store.load()
    expect(store.get().accessModeDefault).toBe('read-only')
    await store.update({ accessModeDefault: 'off' })
    const restarted = new SettingsStore()
    await restarted.load()
    expect(restarted.get().accessModeDefault).toBe('off')
  })

  it.each(['interactive', 'future', 42, null])('normalizes invalid startup access %j to Read-only', async value => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ accessModeDefault: value }))
    const store = new SettingsStore()
    await store.load()
    expect(store.get().accessModeDefault).toBe('read-only')
  })

  it('restores masks, highlights, and frame policy after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const selection = { captureId: 'screen:1', kind: 'monitor' as const, label: 'Monitor', width: 1920, height: 1080 }
    const first = new SettingsStore()
    await first.load()
    await first.setMasks(selection, [{ id: 'secret', x: 10, y: 20, width: 30, height: 40 }])
    await first.setHighlights(selection, [{ id: 'save', shape: 'rect', label: ' Save button ', x: 50, y: 60, width: 70, height: 80 }])
    await first.setFramePolicy(selection, { format: 'png', jpegQuality: 91, maxLongSide: 2048 })

    const restarted = new SettingsStore()
    await restarted.load()
    expect(restarted.masks(selection)).toEqual([{ id: 'secret', x: 10, y: 20, width: 30, height: 40 }])
    expect(restarted.highlights(selection)).toEqual([{ id: 'save', shape: 'rect', label: 'Save button', x: 50, y: 60, width: 70, height: 80 }])
    expect(restarted.framePolicy(selection)).toEqual({ format: 'png', jpegQuality: 91, maxLongSide: 2048 })
  })

  it('drops invalid highlights and normalizes labels and geometry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const selection = { captureId: 'screen:1', kind: 'monitor' as const, label: 'Monitor', width: 1920, height: 1080 }
    const store = new SettingsStore()
    await store.load()
    const invalid = [
      { id: '', shape: 'rect', x: 1, y: 1, width: 1, height: 1 },
      { id: 'future', shape: 'arrow', x: 1, y: 1, width: 1, height: 1 },
      { id: 'nan', shape: 'rect', x: Number.NaN, y: 1, width: 1, height: 1 },
      { id: 'zero', shape: 'rect', x: 1, y: 1, width: 0, height: 1 },
      { id: 'valid', shape: 'rect', label: `  ${'x'.repeat(130)}  `, x: -5, y: -6, width: 20, height: 30 },
      { id: 'empty-label', shape: 'rect', label: '   ', x: 1, y: 2, width: 3, height: 4 },
    ] as unknown as HighlightRect[]

    await store.setHighlights(selection, invalid)

    expect(store.highlights(selection)).toEqual([
      { id: 'valid', shape: 'rect', label: 'x'.repeat(120), x: 0, y: 0, width: 20, height: 30 },
      { id: 'empty-label', shape: 'rect', x: 1, y: 2, width: 3, height: 4 },
    ])
  })

  it('caps highlights at twelve per source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const selection = { captureId: 'screen:1', kind: 'monitor' as const, label: 'Monitor', width: 1920, height: 1080 }
    const store = new SettingsStore()
    await store.load()
    const highlights = Array.from({ length: 13 }, (_, index): HighlightRect => ({ id: `${index}`, shape: 'rect', x: index, y: index, width: 10, height: 10 }))

    await store.setHighlights(selection, highlights)

    expect(store.highlights(selection)).toHaveLength(12)
    expect(store.highlights(selection).at(-1)?.id).toBe('11')
  })

  it('normalizes update knobs without exposing a provider choice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const store = new SettingsStore()
    await store.load()
    expect(store.get().updates).toEqual({ autoCheck: true, checkIntervalMinutes: 120 })
    await store.update({ updates: { autoCheck: false, checkIntervalMinutes: 2 } })
    expect(store.get().updates).toEqual({ autoCheck: false, checkIntervalMinutes: 15 })
    await store.update({ updates: { autoCheck: true, checkIntervalMinutes: 5_000 } })
    expect(store.get().updates).toEqual({ autoCheck: true, checkIntervalMinutes: 1_440 })
  })

  it('defaults picker shortcuts and keeps explicit disables', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    const store = new SettingsStore()
    await store.load()
    expect(store.get().shortcuts).toEqual({ pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' })
    await store.update({ shortcuts: { pickRegion: null, pickWindow: '  Ctrl+F13  ' } })
    expect(store.get().shortcuts).toEqual({ pickRegion: null, pickWindow: 'Ctrl+F13' })
    await store.update({ shortcuts: { pickRegion: 42, pickWindow: '' } as unknown as AppSettings['shortcuts'] })
    expect(store.get().shortcuts).toEqual({ pickRegion: 'Scrolllock', pickWindow: 'Shift+Scrolllock' })
  })

  it('drops the legacy persistent control master without granting interaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-settings-'))
    directories.push(directory)
    process.env.SCREENMCP_HOME = directory
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ closeAction: 'quit', control: { enabled: true } }))
    const store = new SettingsStore()
    await store.load()
    expect(store.get()).not.toHaveProperty('control')
    expect(store.get().closeAction).toBe('quit')
    await store.update({ trayNoticeShown: true })
    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).not.toHaveProperty('control')
  })
})
