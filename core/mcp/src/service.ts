import type { LookOutcome, SourceDescription } from './contract'

export interface ScreenCaptureService {
  look(client: string, changedSince?: string): Promise<LookOutcome>
  waitForChange(client: string, timeoutMs: number): Promise<LookOutcome>
  describeSource(): Promise<SourceDescription>
  readCurrent(client: string): Promise<LookOutcome & { changed: true }>
}

