import { BrowserWindow } from 'electron'
import type { AuditEntry, CaptureState, ControlState, InteractiveRequest, SourceSelection } from '../shared/contracts'

interface StreamMap {
  'capture:state': [CaptureState]
  'capture:stopped': [boolean]
  'source:changed': [SourceSelection | null]
  'audit:entry': [AuditEntry]
  'control:state': [ControlState]
  'interactive:requests': [InteractiveRequest[]]
}

export function publish<K extends keyof StreamMap>(channel: K, ...args: StreamMap[K]): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, ...args)
}
