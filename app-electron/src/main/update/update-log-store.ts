import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AutoUpdateMode, AutoUpdateState } from '../../../../shared/electron/autoUpdate/common/autoUpdate.dto'

// Lines written by earlier versions use other event names; readUpdateLogTail returns them unchanged.
export type UpdateLogEvent = 'updater' | 'state'

export interface UpdateLogEntry {
  ts: number
  event: UpdateLogEvent
  level?: 'info' | 'warn' | 'error'
  message?: string
  mode?: AutoUpdateMode
  running?: string
  state?: AutoUpdateState['kind']
  version?: string | null
}

const MAX_BYTES = 512 * 1024
const KEEP_BYTES = 256 * 1024

export function appendUpdateLog(filePath: string, entry: Omit<UpdateLogEntry, 'ts'>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, 'utf8')
  trimIfOversize(filePath)
}

function trimIfOversize(filePath: string): void {
  let size: number
  try { size = statSync(filePath).size }
  catch { return }
  if (size <= MAX_BYTES) return
  const content = readFileSync(filePath)
  const tail = content.subarray(Math.max(0, content.length - KEEP_BYTES))
  const firstBreak = tail.indexOf(10)
  writeFileSync(filePath, firstBreak === -1 ? '' : tail.subarray(firstBreak + 1))
}

export function readUpdateLogTail(filePath: string, maximumEntries = 200): UpdateLogEntry[] {
  let text: string
  try { text = readFileSync(filePath, 'utf8') }
  catch { return [] }
  const entries: UpdateLogEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line) as UpdateLogEntry) }
    catch { continue }
  }
  return entries.slice(-maximumEntries)
}
