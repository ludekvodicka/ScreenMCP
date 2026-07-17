import { homedir } from 'node:os'
import { join } from 'node:path'

export function configDir(): string {
  return process.env.SCREENMCP_HOME ?? join(homedir(), '.screenmcp')
}

export function endpointPath(): string {
  return join(configDir(), 'endpoint.json')
}

export function settingsPath(): string {
  return join(configDir(), 'settings.json')
}

export function auditDir(): string {
  return join(configDir(), 'audit')
}

export function auditLogPath(): string {
  return join(auditDir(), 'log.jsonl')
}

export function auditThumbnailsDir(): string {
  return join(auditDir(), 'thumbs')
}

export function updateLogPath(): string {
  return join(configDir(), 'update-log.jsonl')
}
