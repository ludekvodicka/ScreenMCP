import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error('usage: pnpm run version:set -- X.Y.Z')
  process.exit(2)
}

const manifests = [
  'package.json',
  'app-electron/package.json',
  'core/capture/package.json',
  'core/mcp/package.json',
]

for (const relative of manifests) {
  const path = resolve(relative)
  const value = JSON.parse(readFileSync(path, 'utf8'))
  value.version = version
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

// pnpm-lock.yaml carries no separate per-workspace version to bump; run `pnpm install` after this to
// refresh the lockfile.
console.log(`ScreenMCP version -> ${version} (run "pnpm install" to update pnpm-lock.yaml)`)
