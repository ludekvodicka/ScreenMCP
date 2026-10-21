import { describe, expect, it } from 'vitest'
import { runtimeLicenses } from './runtime-licenses.mjs'

const common = [
  { name: 'sharp', versions: ['0.35.4'], license: 'Apache-2.0' },
  { name: '@img/colour', versions: ['1.1.0'], license: 'MIT' },
  { name: 'electron-updater', versions: ['6.8.9'], license: 'MIT' },
]

describe('runtime license inventory across release platforms', () => {
  it.each([
    [
      'Windows',
      [
        ['@img/sharp-win32-x64', '0.35.4', 'Apache-2.0 AND LGPL-3.0-or-later'],
        ['@resvg/resvg-js-win32-x64-msvc', '2.6.2', 'MPL-2.0'],
        ['@koromix/koffi-win32-x64', '3.1.1', 'MIT'],
      ],
    ],
    [
      'Linux',
      [
        ['@img/sharp-linux-x64', '0.35.4', 'Apache-2.0'],
        ['@img/sharp-libvips-linux-x64', '1.3.4', 'LGPL-3.0-or-later'],
        ['@resvg/resvg-js-linux-x64-gnu', '2.6.2', 'MPL-2.0'],
        ['@koromix/koffi-linux-x64', '3.1.1', 'MIT'],
      ],
    ],
    [
      'macOS',
      [
        ['@img/sharp-darwin-arm64', '0.35.4', 'Apache-2.0'],
        ['@img/sharp-libvips-darwin-arm64', '1.3.4', 'LGPL-3.0-or-later'],
        ['@resvg/resvg-js-darwin-arm64', '2.6.2', 'MPL-2.0'],
        ['@koromix/koffi-darwin-arm64', '3.1.1', 'MIT'],
      ],
    ],
  ])('keeps the same inventory for %s without losing shared packages', (_platform, bindings) => {
    const entries = bindings.map(([name, version, license]) => ({ name, versions: [version], license }))
    expect(runtimeLicenses({ packages: [...common, ...entries] })).toEqual(new Map([
      ['sharp@0.35.4', 'Apache-2.0'],
      ['@img/colour@1.1.0', 'MIT'],
      ['electron-updater@6.8.9', 'MIT'],
    ]))
  })

  it('refuses a native binding license absent from the family notice', () => {
    expect(() => runtimeLicenses({ packages: [{ name: '@img/sharp-linux-x64', versions: ['0.35.4'], license: 'GPL-3.0-only' }] }))
      .toThrow('Unattributed native license')
  })

  it('retains an unfamiliar runtime package rather than silently omitting it', () => {
    expect(runtimeLicenses({ MIT: [{ name: '@img/new-runtime', versions: ['1.0.0'] }] }))
      .toEqual(new Map([['@img/new-runtime@1.0.0', 'MIT']]))
  })
})
