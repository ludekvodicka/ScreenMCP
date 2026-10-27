import { describe, expect, it } from 'vitest'
import { productionIdentities, runtimeLicenses } from './runtime-licenses.mjs'

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
    const production = new Set([...common, ...entries].map(({ name, versions }) => `${name}@${versions[0]}`))
    expect(runtimeLicenses({ packages: [...common, ...entries] }, production)).toEqual(new Map([
      ['sharp@0.35.4', 'Apache-2.0'],
      ['@img/colour@1.1.0', 'MIT'],
      ['electron-updater@6.8.9', 'MIT'],
    ]))
  })

  it('refuses a native binding license absent from the family notice', () => {
    expect(() => runtimeLicenses({ packages: [{ name: '@img/sharp-linux-x64', versions: ['0.35.4'], license: 'GPL-3.0-only' }] },
      new Set(['@img/sharp-linux-x64@0.35.4'])))
      .toThrow('Unattributed native license')
  })

  it('retains an unfamiliar runtime package rather than silently omitting it', () => {
    expect(runtimeLicenses({ MIT: [{ name: '@img/new-runtime', versions: ['1.0.0'] }] }, new Set(['@img/new-runtime@1.0.0'])))
      .toEqual(new Map([['@img/new-runtime@1.0.0', 'MIT']]))
  })

  it('omits installed packages outside the production tree', () => {
    const licenses = { MIT: [{ name: 'zod', versions: ['4.4.3'] }, { name: 'vitest', versions: ['4.1.11'] }, { name: 'semver', versions: ['7.7.4', '7.8.5'] }] }
    expect(runtimeLicenses(licenses, new Set(['zod@4.4.3', 'semver@7.8.5'])))
      .toEqual(new Map([['zod@4.4.3', 'MIT'], ['semver@7.8.5', 'MIT']]))
  })
})

describe('production package identities', () => {
  it('includes transitive optional dependencies by their real names, without platform binding subtrees', () => {
    const projects = [{
      name: 'screenmcp',
      dependencies: {
        'get-windows': {
          from: 'get-windows',
          version: '9.3.0',
          optionalDependencies: {
            '@mapbox/node-pre-gyp': { from: '@mapbox/node-pre-gyp', version: '2.0.3', dependencies: { tar: { from: 'tar', version: '7.5.22' } } },
          },
        },
        '@isaacs/cliui': { from: '@isaacs/cliui', version: '8.0.2', dependencies: { 'wrap-ansi-cjs': { from: 'wrap-ansi', version: '7.0.0' } } },
        sharp: {
          from: 'sharp',
          version: '0.35.4',
          optionalDependencies: {
            '@img/sharp-wasm32': { from: '@img/sharp-wasm32', version: '0.35.4', dependencies: { '@emnapi/runtime': { from: '@emnapi/runtime', version: '1.11.3' } } },
          },
        },
      },
    }]
    expect(productionIdentities(projects)).toEqual(new Set([
      'get-windows@9.3.0', '@mapbox/node-pre-gyp@2.0.3', 'tar@7.5.22', '@isaacs/cliui@8.0.2', 'wrap-ansi@7.0.0',
      'sharp@0.35.4', '@img/sharp-wasm32@0.35.4',
    ]))
  })
})
