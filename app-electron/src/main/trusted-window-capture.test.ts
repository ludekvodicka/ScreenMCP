import { describe, expect, it } from 'vitest'
import { validateTrustedWindowCapture, type TrustedWindowCaptureSource } from './trusted-window-capture'

describe('trusted unlisted window capture', () => {
  const source: TrustedWindowCaptureSource = { kind: 'verified-unlisted-window', id: 'window:59317952:0', name: ' Total Commander ' }

  it('accepts only the exact unsigned Win32 window source', () => {
    expect(validateTrustedWindowCapture(source.id, source, 'win32')).toEqual({ ...source, name: 'Total Commander' })
    expect(() => validateTrustedWindowCapture('window:1:0', source, 'win32')).toThrow('Invalid trusted window capture source')
    expect(() => validateTrustedWindowCapture(source.id, source, 'linux')).toThrow('Invalid trusted window capture source')
    expect(() => validateTrustedWindowCapture('window:59317952:1', { ...source, id: 'window:59317952:1' }, 'win32')).toThrow('Invalid trusted window capture source')
    expect(() => validateTrustedWindowCapture('window:-1:0', { ...source, id: 'window:-1:0' }, 'win32')).toThrow('Invalid trusted window capture source')
  })

  it('throws for a future trusted-source kind', () => {
    expect(() => validateTrustedWindowCapture(source.id, { ...source, kind: 'future' } as unknown as TrustedWindowCaptureSource, 'win32')).toThrow('Unknown trusted capture source')
  })
})
