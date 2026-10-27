import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { productionIdentities, runtimeLicenses } from './runtime-licenses.mjs'

const pnpmJson = command => JSON.parse(execSync(`pnpm ${command} --json`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
const root = JSON.parse(readFileSync('package.json', 'utf8'))
const packages = runtimeLicenses(pnpmJson('licenses list'), productionIdentities(pnpmJson('list --prod --depth Infinity')))

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
  'below. This inventory is generated from the installed pnpm production tree. Platform-specific',
  'bindings are checked and attributed by family under "Native and WASM payloads" rather than listed',
  'as packages for just one operating system. The dependency licenses remain',
  'in force for their respective components.',
  '',
  '## Direct runtime dependencies',
  '',
  ...direct.map(([name, version]) => `- \`${name}@${version}\``),
  '',
  '## Native and WASM payloads',
  '',
  '- `@resvg/resvg-js` and its `@resvg/resvg-js-*` platform bindings declare MPL-2.0.',
  '- `sharp` declares Apache-2.0. Its `@img/sharp-*` platform bindings declare Apache-2.0,',
  '  LGPL-3.0-or-later, or Apache-2.0 AND LGPL-3.0-or-later, including bundled libvips.',
  '- `get-windows` ships a platform helper under its MIT package license.',
  '- `koffi` and its `@koromix/koffi-*` prebuilt Node-API bindings declare MIT.',
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
