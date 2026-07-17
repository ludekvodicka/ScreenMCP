import { contextBridge, ipcRenderer } from 'electron'
import type { PickerOverlayApi, PickerOverlayState } from '../shared/contracts'

const api: PickerOverlayApi = {
  pointer: point => ipcRenderer.send('picker:pointer', point),
  selectWindow: point => ipcRenderer.send('picker:select-window', point),
  selectRectangle: (start, end) => ipcRenderer.send('picker:select-rectangle', start, end),
  cancel: () => ipcRenderer.send('picker:cancel'),
  onState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: PickerOverlayState): void => callback(state)
    ipcRenderer.on('picker:state', listener)
    return () => ipcRenderer.removeListener('picker:state', listener)
  },
}

contextBridge.exposeInMainWorld('pickerOverlay', api)
