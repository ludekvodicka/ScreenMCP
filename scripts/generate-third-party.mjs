import { readFileSync, writeFileSync } from 'node:fs'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const root = JSON.parse(readFileSync('package.json', 'utf8'))
const packages = new Map()
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path.includes('node_modules/') || metadata.dev) continue
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  if (metadata.link || name.startsWith('@screenmcp/')) continue
  if (!metadata.version || !metadata.license) throw new Error(`Missing version/license metadata for ${path}`)
  packages.set(`${name}@${metadata.version}`, metadata.license)
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
  'below. This inventory is generated from `package-lock.json`, including optional native packages',
  'for every supported OS; the dependency licenses remain in force for their respective components.',
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
  '## Locked runtime inventory by declared license',
  '',
]
for (const [license, identities] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`### ${license}`, '', ...identities.map(identity => `- \`${identity}\``), '')
}
lines.push('License identifiers are SPDX expressions copied from the exact lock entries. Full license', 'texts are retained in the installed npm packages and are available from each package source.', '')
const output = `${lines.join('\n')}\n`

if (process.argv.includes('--check')) {
  const current = readFileSync('THIRD-PARTY.md', 'utf8')
  if (current !== output) throw new Error('THIRD-PARTY.md is stale; regenerate it from scripts/generate-third-party.mjs')
  console.log(`third-party inventory OK: ${packages.size} locked runtime packages`)
} else if (process.argv.includes('--write')) writeFileSync('THIRD-PARTY.md', output)
else process.stdout.write(output)
