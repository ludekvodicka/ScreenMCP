import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const platform = process.argv[2]
const output = resolve(process.argv[3] ?? 'release')
const contracts = {
  win: { metadata: 'latest.yml', extension: '.exe', required: 'Setup', forbidden: 'Portable' },
  linux: { metadata: 'latest-linux.yml', extension: '.AppImage' },
}
const contract = contracts[platform]
if (!contract) {
  console.error('usage: npm run release:smoke -- win|linux [output-directory]')
  process.exit(2)
}

const metadataPath = resolve(output, contract.metadata)
if (!existsSync(metadataPath)) throw new Error(`Missing updater metadata: ${metadataPath}`)
const metadata = readFileSync(metadataPath, 'utf8')
const match = metadata.match(/^path:\s*(.+?)\s*$/m)
if (!match?.[1]) throw new Error(`${contract.metadata} has no top-level path`)
const relative = match[1].replace(/^['"]|['"]$/g, '')
if (relative !== basename(relative)) throw new Error(`Updater path must be a basename: ${relative}`)
if (/\s/.test(relative)) throw new Error(`Updater asset contains whitespace: ${relative}`)
if ('extension' in contract && !relative.endsWith(contract.extension)) throw new Error(`Updater asset ${relative} must end in ${contract.extension}`)
if ('required' in contract && !relative.includes(contract.required)) throw new Error(`Updater asset ${relative} must contain ${contract.required}`)
if ('forbidden' in contract && relative.includes(contract.forbidden)) throw new Error(`Updater asset ${relative} must not contain ${contract.forbidden}`)
const asset = resolve(output, relative)
if (!existsSync(asset)) throw new Error(`${contract.metadata} references missing asset: ${asset}`)
console.log(`${platform} updater feed OK: ${contract.metadata} -> ${relative}`)
