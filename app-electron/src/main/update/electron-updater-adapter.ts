import electronUpdater from 'electron-updater'
import type { UpdateDownloadProgress } from '../../shared/contracts'
import type { UpdateAdapter, UpdateCheckResult } from './update-manager'

const { autoUpdater } = electronUpdater

export class ElectronUpdaterAdapter implements UpdateAdapter {
  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = {
      info: message => console.info('[auto-updater]', message),
      warn: message => console.warn('[auto-updater]', message),
      error: message => console.error('[auto-updater]', message),
      debug: () => {},
    }
  }

  onProgress(listener: (progress: Omit<UpdateDownloadProgress, 'version'>) => void): () => void {
    const handler = (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }): void => listener({
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: Math.round(progress.bytesPerSecond),
    })
    autoUpdater.on('download-progress', handler)
    return () => autoUpdater.removeListener('download-progress', handler)
  }

  onDownloaded(listener: (version: string) => void): () => void {
    const handler = (info: { version: string }): void => listener(info.version)
    autoUpdater.on('update-downloaded', handler)
    return () => autoUpdater.removeListener('update-downloaded', handler)
  }

  onError(listener: (error: Error) => void): () => void {
    const handler = (error: Error): void => listener(error)
    autoUpdater.on('error', handler)
    return () => autoUpdater.removeListener('error', handler)
  }

  async check(): Promise<UpdateCheckResult> {
    const result = await autoUpdater.checkForUpdates()
    return {
      available: result?.isUpdateAvailable === true,
      version: result?.updateInfo?.version ?? null,
    }
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }

  install(): void {
    autoUpdater.quitAndInstall(false, true)
  }

  dispose(): void {}
}
