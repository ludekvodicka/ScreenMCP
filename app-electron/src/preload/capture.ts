import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureWorkerApi, CaptureWorkerRequest, CaptureWorkerResponse } from '../shared/contracts'

const api: CaptureWorkerApi = {
  onRequest(callback) {
    const listener = (_event: Electron.IpcRendererEvent, request: CaptureWorkerRequest): void => callback(request)
    ipcRenderer.on('capture-worker:request', listener)
    return () => ipcRenderer.removeListener('capture-worker:request', listener)
  },
  respond(response: CaptureWorkerResponse) {
    ipcRenderer.send('capture-worker:response', response)
  },
}

contextBridge.exposeInMainWorld('captureWorker', api)
