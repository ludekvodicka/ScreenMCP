import { appendFileSync } from 'node:fs'

export function smokeLog(message: string): void {
  const output = process.env.SCREENMCP_CAPTURE_SMOKE
  if (!output) return
  appendFileSync(`${output}.log`, `${new Date().toISOString()} ${message}\n`, 'utf8')
}
