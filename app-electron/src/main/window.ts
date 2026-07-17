import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'node:path'
import { appIcon } from './app-icon'
import type { SettingsStore } from './settings-store'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setQuitting(value: boolean): void {
  quitting = value
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function showMainWindow(): void {
  const window = getMainWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export interface MainWindowReveal {
  restore(): Promise<void>
}

export function revealMainWindow(): MainWindowReveal {
  const window = getMainWindow()
  if (!window) throw new Error('ScreenMCP window is unavailable')
  const prior = window.isMinimized() ? 'minimized' : !window.isVisible() ? 'hidden' : window.isFocused() ? 'focused' : 'unfocused'
  let restored = false
  showMainWindow()
  return {
    restore: async () => {
      if (restored || window.isDestroyed()) return
      restored = true
      if (prior === 'hidden') window.hide()
      else if (prior === 'minimized') window.minimize()
      else if (prior === 'unfocused') window.blur()
      else if (prior !== 'focused') throw new Error(`Unknown window presentation: ${JSON.stringify(prior)}`)
      await new Promise<void>(resolve => setImmediate(resolve))
    },
  }
}

export function createMainWindow(settings: SettingsStore): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#08111f',
    title: 'ScreenMCP',
    icon: appIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  })
  mainWindow = window
  window.on('ready-to-show', () => window.show())
  window.on('close', event => {
    if (quitting) return
    if (settings.get().closeAction === 'quit') {
      event.preventDefault()
      setQuitting(true)
      app.quit()
      return
    }
    event.preventDefault()
    window.hide()
    if (!settings.get().trayNoticeShown) {
      new Notification({ title: 'ScreenMCP is still running', body: 'Use the tray icon to reopen or stop ScreenMCP.' }).show()
      void settings.update({ trayNoticeShown: true })
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl && !app.isPackaged) void window.loadURL(developmentUrl)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return window
}
