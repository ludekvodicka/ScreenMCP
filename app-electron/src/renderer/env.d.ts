/// <reference types="vite/client" />
import type { CaptureWorkerApi, PickerOverlayApi, ScreenMcpApi } from '../shared/contracts'

declare global {
  interface Window {
    screenmcp: ScreenMcpApi
    captureWorker: CaptureWorkerApi
    pickerOverlay: PickerOverlayApi
  }
}

export {}
