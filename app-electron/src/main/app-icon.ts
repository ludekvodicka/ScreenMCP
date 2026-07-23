import { Resvg } from '@resvg/resvg-js'
import { nativeImage, type NativeImage } from 'electron'

// Same artwork as buildResources/icon.svg (the installer icon); rendered in-process like the
// tray icon so dev and packaged windows both get it without bundling asset paths.
const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#132945"/>
      <stop offset="1" stop-color="#07111e"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#background)"/>
  <rect x="150" y="190" width="724" height="500" rx="92" fill="#081321" stroke="#62dbff" stroke-width="56"/>
  <path d="M350 824h324M512 690v134" fill="none" stroke="#62dbff" stroke-width="62" stroke-linecap="round"/>
  <circle cx="766" cy="302" r="72" fill="#54d5a4"/>
</svg>`

let cached: NativeImage | null = null

export function appIcon(): NativeImage {
  if (cached) return cached
  const png = new Resvg(APP_ICON_SVG, { fitTo: { mode: 'width', value: 256 } }).render().asPng()
  cached = nativeImage.createFromBuffer(png)
  return cached
}
