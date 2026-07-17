import { desktopCapturer, screen } from 'electron'
import type { CaptureSource } from '../shared/contracts'

export function isWayland(): boolean {
  return process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
}

export async function enumerateSources(): Promise<CaptureSource[]> {
  if (isWayland()) return []
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 384, height: 240 },
  })
  const displays = new Map(screen.getAllDisplays().map(display => [String(display.id), display]))
  return sources.map(source => {
    const display = displays.get(source.display_id)
    const size = display?.size
    const emptyThumbnail = source.thumbnail.isEmpty()
    return {
      id: source.id,
      kind: 'monitor',
      label: source.name,
      thumbnailDataUrl: emptyThumbnail ? '' : source.thumbnail.toDataURL(),
      appIconDataUrl: null,
      displayId: source.display_id,
      width: size?.width ?? null,
      height: size?.height ?? null,
      warning: emptyThumbnail ? 'Preview unavailable for this display.' : null,
    }
  })
}
