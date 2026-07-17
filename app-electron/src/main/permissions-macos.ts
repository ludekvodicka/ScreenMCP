import { app, desktopCapturer, shell, systemPreferences } from 'electron'
import type { MacScreenPermission } from '../shared/contracts'

export class MacScreenPermissionService {
  private restartRequired = false

  state(): MacScreenPermission {
    if (process.platform !== 'darwin') return 'not-applicable'
    if (this.restartRequired) return 'restart-required'
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'granted') return 'granted'
    else if (status === 'not-determined') return 'request-required'
    else if (status === 'denied' || status === 'restricted' || status === 'unknown') return 'denied'
    else throw new Error(`Unknown screen access status: ${JSON.stringify(status)}`)
  }

  canCapture(): boolean {
    const state = this.state()
    if (state === 'not-applicable' || state === 'granted') return true
    else if (state === 'request-required' || state === 'denied' || state === 'restart-required') return false
    else throw new Error(`Unknown macOS permission state: ${JSON.stringify(state)}`)
  }

  async request(): Promise<MacScreenPermission> {
    const state = this.state()
    if (state === 'request-required') {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      this.restartRequired = true
      return 'restart-required'
    } else if (state === 'not-applicable' || state === 'granted' || state === 'denied' || state === 'restart-required') return state
    else throw new Error(`Unknown macOS permission state: ${JSON.stringify(state)}`)
  }

  async openSettings(): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('Screen Recording settings are only available on macOS')
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  }

  relaunch(): void {
    if (process.platform !== 'darwin') throw new Error('Permission relaunch is only available on macOS')
    app.relaunch()
    app.quit()
  }
}
