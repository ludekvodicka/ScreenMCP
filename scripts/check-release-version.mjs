import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifests = [
  'package.json',
  'app-electron/package.json',
  'core/capture/package.json',
  'core/mcp/package.json',
]
const versions = manifests.map(relative => [relative, JSON.parse(readFileSync(resolve(relative), 'utf8')).version])
const expected = versions[0]?.[1]
if (typeof expected !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expected))
  throw new Error(`Invalid root release version: ${JSON.stringify(expected)}`)
for (const [relative, version] of versions)
  if (version !== expected) throw new Error(`${relative} version ${JSON.stringify(version)} does not match ${expected}`)

const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
if (lock.version !== expected) throw new Error(`package-lock.json version ${JSON.stringify(lock.version)} does not match ${expected}`)
for (const key of ['', 'app-electron', 'core/capture', 'core/mcp']) {
  const version = lock.packages?.[key]?.version
  if (version !== expected) throw new Error(`package-lock.json packages[${JSON.stringify(key)}] version ${JSON.stringify(version)} does not match ${expected}`)
}

const argument = process.argv[2]
const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
const tag = argument ?? environmentTag
if (tag && tag !== `v${expected}`) throw new Error(`Tag ${JSON.stringify(tag)} does not match package version v${expected}`)
console.log(`release version OK: ${expected}${tag ? ` (${tag})` : ''}`)
