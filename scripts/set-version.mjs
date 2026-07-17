import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = process.argv[2]
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error('usage: npm run version:set -- X.Y.Z')
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

const lockPath = resolve('package-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
lock.version = version
for (const key of ['', 'app-electron', 'core/capture', 'core/mcp']) {
  const entry = lock.packages?.[key]
  if (!entry) throw new Error(`package-lock.json is missing packages[${JSON.stringify(key)}]`)
  entry.version = version
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`ScreenMCP version -> ${version}`)
