import { writeFile } from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import type { ScreenCaptureService } from '../../../core/mcp/src/service'
import type { CaptureController } from './capture-controller'
import { smokeLog } from './smoke-log'

export async function runCaptureSmoke(capture: CaptureController, service: ScreenCaptureService, outputPath: string): Promise<void> {
  const surface = new BrowserWindow({ width: 720, height: 480, x: 30, y: 30, show: true, backgroundColor: '#12618c' })
  try {
    await surface.loadURL('data:text/html,<body style="margin:0;background:%2312618c;color:white;font:48px sans-serif;display:grid;place-items:center"><div>ScreenMCP X11 capture</div></body>')
    console.log('[capture-smoke] enumerating sources')
    smokeLog('enumerating sources')
    const sources = await capture.listSources()
    const source = sources.find(candidate => candidate.kind === 'monitor') ?? sources[0]
    if (!source) throw new Error('No capture source is available for the smoke test')
    console.log(`[capture-smoke] selecting ${source.id}`)
    smokeLog(`selecting ${source.id}`)
    await capture.select({ captureId: source.id, kind: source.kind, label: source.label })
    console.log('[capture-smoke] calling look')
    smokeLog('calling look')
    const outcome = await service.look('xvfb-smoke')
    if (!outcome.changed) throw new Error('Capture smoke look returned no image')
    await writeFile(outputPath, outcome.data)
    if (outcome.width < 100 || outcome.height < 100) throw new Error(`Captured frame is implausibly small: ${outcome.width}x${outcome.height}`)
    console.log(`[capture-smoke] wrote ${outcome.width}x${outcome.height}`)
    smokeLog(`wrote ${outcome.width}x${outcome.height}`)
  } finally {
    surface.destroy()
  }
}
