import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Sourced from the installed pnpm production tree (`pnpm licenses list --prod --json`) rather than the
// old package-lock.json. pnpm resolves only the current platform's optional native binaries, so the
// per-package inventory below is current-platform; the cross-platform native families (sharp, resvg,
// koffi, tesseract) stay attributed by family in the "Native and WASM payloads" section, which covers
// every packaged OS.
const root = JSON.parse(readFileSync('package.json', 'utf8'))
const licensesByGroup = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))

const packages = new Map()
for (const [licenseKey, entries] of Object.entries(licensesByGroup)) {
  for (const entry of entries) {
    const name = entry.name
    if (!name || name === 'screenmcp' || name.startsWith('@screenmcp/')) continue
    const license = entry.license ?? licenseKey
    for (const version of entry.versions ?? []) {
      if (!version || !license) throw new Error(`Missing version/license metadata for ${name}`)
      packages.set(`${name}@${version}`, license)
    }
  }
}

const direct = Object.entries(root.dependencies ?? {}).sort(([left], [right]) => left.localeCompare(right))
const groups = new Map()
for (const [identity, license] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
  const values = groups.get(license) ?? []
  values.push(identity)
  groups.set(license, values)
}

const lines = [
  '# Third-party software',
  '',
  'ScreenMCP is MIT-licensed. Its packaged application also contains the npm runtime dependencies',
  'below. This inventory is generated from the installed pnpm production tree; cross-platform native',
  'binaries are attributed by family under "Native and WASM payloads". The dependency licenses remain',
  'in force for their respective components.',
  '',
  '## Direct runtime dependencies',
  '',
  ...direct.map(([name, version]) => `- \`${name}@${version}\``),
  '',
  '## Native and WASM payloads',
  '',
  '- `@resvg/resvg-js` and its platform bindings declare MPL-2.0.',
  '- `sharp` declares Apache-2.0. Its platform packages can bundle libvips components declared under',
  '  Apache-2.0, LGPL-3.0-or-later, and MIT as recorded below.',
  '- `get-windows` ships a platform helper under its MIT package license.',
  '- `koffi` ships prebuilt Node-API bindings under its MIT package license.',
  '- `tesseract.js` and `tesseract.js-core` ship the Apache-2.0 OCR/WASM runtime; bundled English',
  '  trained data comes from `@tesseract.js-data/eng` under MIT.',
  '',
  '## Runtime inventory by declared license',
  '',
]
for (const [license, identities] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`### ${license}`, '', ...identities.map(identity => `- \`${identity}\``), '')
}
lines.push('License identifiers are SPDX expressions from each installed package. Full license texts are',
  'retained in the installed npm packages and are available from each package source.', '')
const output = `${lines.join('\n')}\n`

if (process.argv.includes('--check')) {
  const current = readFileSync('THIRD-PARTY.md', 'utf8')
  if (current !== output) throw new Error('THIRD-PARTY.md is stale; regenerate it from scripts/generate-third-party.mjs')
  console.log(`third-party inventory OK: ${packages.size} runtime packages`)
} else if (process.argv.includes('--write')) writeFileSync('THIRD-PARTY.md', output)
else process.stdout.write(output)
