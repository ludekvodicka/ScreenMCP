import { desktopCapturer } from 'electron'
import type { SourceSelection } from '../shared/contracts'
import { captureHwnd } from './coordinate-resolver'
import { activeModalWindowWin32 } from './native-window-enum'
import { matchCaptureWindowSource, win32WindowCaptureId, type CaptureWindowMetadata, type NativeWindowMetadata } from './source-picker-geometry'

export type WindowDialogCaptureTarget =
  | { kind: 'listed'; id: string }
  | { kind: 'unlisted'; id: string }

export type WindowDialogResolution =
  | { kind: 'root' }
  | { kind: 'dialog'; capture: WindowDialogCaptureTarget; label: string }

export interface WindowDialogEnvironment {
  platform: NodeJS.Platform
  activeModal(rootHwnd: number): NativeWindowMetadata | null
  captureWindows(): Promise<CaptureWindowMetadata[]>
}

export interface WindowDialogResolver {
  resolve(root: SourceSelection): Promise<WindowDialogResolution>
}

export class WindowDialogFollower implements WindowDialogResolver {
  constructor(private environment: WindowDialogEnvironment = defaultEnvironment()) {}

  async resolve(root: SourceSelection): Promise<WindowDialogResolution> {
    if (root.kind === 'monitor' || root.kind === 'region') return { kind: 'root' }
    else if (root.kind !== 'window') throw new Error(`Unknown source kind: ${JSON.stringify(root.kind)}`)
    if (this.environment.platform !== 'win32') return { kind: 'root' }
    const modal = this.environment.activeModal(captureHwnd(root))
    if (!modal) return { kind: 'root' }
    const source = matchCaptureWindowSource(modal.id, await this.environment.captureWindows(), 'win32')
    if (source?.id === root.captureId) return { kind: 'root' }
    const label = source?.name.trim() || modal.title.trim() || 'Dialog'
    return source
      ? { kind: 'dialog', capture: { kind: 'listed', id: source.id }, label }
      : { kind: 'dialog', capture: { kind: 'unlisted', id: win32WindowCaptureId(modal.id) }, label }
  }
}

function defaultEnvironment(): WindowDialogEnvironment {
  return {
    platform: process.platform,
    activeModal: rootHwnd => activeModalWindowWin32(rootHwnd),
    captureWindows: async () => (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })).map(source => ({ id: source.id, name: source.name })),
  }
}
