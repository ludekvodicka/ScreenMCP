import { describe, expect, it } from 'vitest'
import type { AccessMode, StartupAccessMode } from '../shared/contracts'
import type { AppState } from './app-state'
import { AccessModeController, applyStartupAccessMode } from './access-mode'
import type { ElectronControlService } from './control-service'

describe('AccessModeController', () => {
  it('selects Off through the authoritative stopped gate', () => {
    const fixture = createFixture(false, true)
    fixture.access.setMode('off')
    expect(fixture.log).toEqual(['stopped:true'])
    expect(fixture.access.getMode()).toBe('off')
  })

  it('disarms before resuming into Read-only', () => {
    const fixture = createFixture(true, false)
    fixture.access.setMode('read-only')
    expect(fixture.log).toEqual(['disarm:manual', 'stopped:false'])
    expect(fixture.access.getMode()).toBe('read-only')
  })

  it('resumes and arms as one Interactive transition', () => {
    const fixture = createFixture(true, false)
    fixture.access.setMode('interactive')
    expect(fixture.log).toEqual(['stopped:false', 'arm'])
    expect(fixture.access.getMode()).toBe('interactive')
  })

  it('rolls back to Off when arming after resume fails', () => {
    const fixture = createFixture(true, false, new Error('no source'))
    expect(() => fixture.access.setMode('interactive')).toThrow('no source')
    expect(fixture.log).toEqual(['stopped:false', 'arm', 'stopped:true'])
    expect(fixture.access.getMode()).toBe('off')
  })

  it('keeps Read-only when arming fails without a prior Off state', () => {
    const fixture = createFixture(false, false, new Error('no source'))
    expect(() => fixture.access.setMode('interactive')).toThrow('no source')
    expect(fixture.log).toEqual(['arm'])
    expect(fixture.access.getMode()).toBe('read-only')
  })

  it('rejects unknown modes', () => {
    const fixture = createFixture(false, false)
    expect(() => fixture.access.setMode('future' as AccessMode)).toThrow('Unknown access mode')
  })
})

describe('startup access mode', () => {
  it.each([
    ['off', true],
    ['read-only', false],
  ] satisfies [StartupAccessMode, boolean][])('applies %s before startup as stopped=%s', (mode, expected) => {
    const fixture = createFixture(!expected, false)
    applyStartupAccessMode(fixture.appState, mode)
    expect(fixture.stopped()).toBe(expected)
  })

  it('rejects unknown startup modes', () => {
    const fixture = createFixture(false, false)
    expect(() => applyStartupAccessMode(fixture.appState, 'interactive' as StartupAccessMode)).toThrow('Unknown startup access mode')
  })
})

function createFixture(initialStopped: boolean, initialArmed: boolean, armError?: Error) {
  let stopped = initialStopped
  let armed = initialArmed
  const log: string[] = []
  const appState = {
    isStopped: () => stopped,
    setStopped: (value: boolean) => { log.push(`stopped:${value}`); stopped = value; if (value) armed = false },
  } as unknown as AppState
  const control = {
    getState: () => ({ armed, sourceKey: armed ? 'window:Editor' : null }),
    disarm: (reason: string) => { log.push(`disarm:${reason}`); armed = false },
    arm: () => { log.push('arm'); if (armError) throw armError; armed = true },
  } as unknown as ElectronControlService
  return { access: new AccessModeController(appState, control), appState, log, stopped: () => stopped }
}
