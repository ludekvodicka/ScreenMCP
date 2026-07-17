import { describe, expect, it } from 'vitest'
import { resolveUpdateRuntime } from './update-runtime'

const settings = { autoCheck: true, checkIntervalMinutes: 120 }

describe('resolveUpdateRuntime', () => {
  it('uses GitHub only for installed Windows and packaged Linux', () => {
    expect(resolveUpdateRuntime({ packaged: true, platform: 'win32', portable: false, settings }).channel).toBe('github')
    expect(resolveUpdateRuntime({ packaged: true, platform: 'linux', portable: false, settings }).channel).toBe('github')
  })

  it('keeps development, portable Windows, and unsigned macOS manual', () => {
    const development = resolveUpdateRuntime({ packaged: false, platform: 'win32', portable: false, settings })
    const portable = resolveUpdateRuntime({ packaged: true, platform: 'win32', portable: true, settings })
    const mac = resolveUpdateRuntime({ packaged: true, platform: 'darwin', portable: false, settings })
    expect(development.channel).toBe('none')
    expect(development.reason).toContain('Development')
    expect(portable.channel).toBe('none')
    expect(portable.reason).toContain('Portable')
    expect(mac.channel).toBe('none')
    expect(mac.reason).toContain('signed')
  })

  it('carries only update knobs and rejects unsupported platforms', () => {
    const resolution = resolveUpdateRuntime({ packaged: true, platform: 'linux', portable: false, settings: { autoCheck: false, checkIntervalMinutes: 33 } })
    expect(resolution).toMatchObject({ channel: 'github', autoCheck: false, checkIntervalMinutes: 33 })
    expect(() => resolveUpdateRuntime({ packaged: true, platform: 'freebsd', portable: false, settings })).toThrow('Unsupported update platform')
  })
})
