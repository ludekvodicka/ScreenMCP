import type { ToolErrorCode } from './contract'

export class ScreenMcpError extends Error {
  constructor(public code: ToolErrorCode, message: string) {
    super(message)
    this.name = 'ScreenMcpError'
  }
}

export function asScreenMcpError(error: unknown): ScreenMcpError {
  if (error instanceof ScreenMcpError) return error
  return new ScreenMcpError('capture_failed', error instanceof Error ? error.message : String(error))
}

