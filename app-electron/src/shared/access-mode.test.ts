import { describe, expect, it } from 'vitest'
import type { AccessMode } from './contracts'
import { accessMode, accessModeLabel } from './access-mode'

describe('access mode derivation', () => {
  it.each([
    [{ stopped: true, armed: false }, 'off'],
    [{ stopped: true, armed: true }, 'off'],
    [{ stopped: false, armed: false }, 'read-only'],
    [{ stopped: false, armed: true }, 'interactive'],
  ] as const)('derives %j as %s', (state, expected) => {
    expect(accessMode(state)).toBe(expected)
  })

  it.each([
    ['off', 'Off'],
    ['read-only', 'Read-only'],
    ['interactive', 'Interactive'],
  ] satisfies [AccessMode, string][])('labels %s as %s', (mode, expected) => {
    expect(accessModeLabel(mode)).toBe(expected)
  })

  it('rejects unknown runtime values', () => {
    expect(() => accessMode({ stopped: 'no' as unknown as boolean, armed: false })).toThrow('Unknown access state')
    expect(() => accessModeLabel('future' as AccessMode)).toThrow('Unknown access mode')
  })
})
