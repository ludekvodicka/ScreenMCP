import type { CaptureState } from '../shared/contracts'
import { publish } from './streams'

export interface AppStateSnapshot {
  stopped: boolean
  captureState: CaptureState
}

export class AppState {
  private stopped = false
  private captureState: CaptureState = { kind: 'disconnected' }
  private listeners = new Set<(snapshot: AppStateSnapshot) => void>()

  isStopped(): boolean {
    return this.stopped
  }

  setStopped(stopped: boolean): void {
    this.stopped = stopped
    publish('capture:stopped', stopped)
    this.notify()
  }

  getCaptureState(): CaptureState {
    return structuredClone(this.captureState)
  }

  setCaptureState(state: CaptureState): void {
    this.captureState = structuredClone(state)
    publish('capture:state', state)
    this.notify()
  }

  subscribe(listener: (snapshot: AppStateSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  private snapshot(): AppStateSnapshot {
    return { stopped: this.stopped, captureState: this.getCaptureState() }
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
