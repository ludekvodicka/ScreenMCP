function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing capture worker element: ${selector}`)
  return element
}

const video = requiredElement<HTMLVideoElement>('#capture-video')
const canvas = requiredElement<HTMLCanvasElement>('#capture-canvas')

let stream: MediaStream | null = null
let lastFrameAt = Date.now()
let trackingFrame = false

function trackFrames(): void {
  if (trackingFrame || !('requestVideoFrameCallback' in video)) return
  trackingFrame = true
  const tick = (): void => {
    lastFrameAt = Date.now()
    video.requestVideoFrameCallback(tick)
  }
  video.requestVideoFrameCallback(tick)
}

async function start(): Promise<{ width: number; height: number }> {
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false })
  video.srcObject = stream
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Capture video metadata timed out')), 15_000)
    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      void video.play().then(() => resolve(), reject)
    }
  })
  lastFrameAt = Date.now()
  trackingFrame = false
  trackFrames()
  return { width: video.videoWidth, height: video.videoHeight }
}

function stop(): void {
  for (const track of stream?.getTracks() ?? []) track.stop()
  stream = null
  video.srcObject = null
}

function assertLive(): void {
  if (!stream || stream.getVideoTracks()[0]?.readyState !== 'live' || video.videoWidth < 1 || video.videoHeight < 1) throw new Error('Capture stream is not live')
}

function grab() {
  assertLive()
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas is unavailable')
  context.drawImage(video, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const capturedAt = Date.now()
  return { rgba: new Uint8Array(image.data), width: canvas.width, height: canvas.height, capturedAt, frameAgeMs: Math.max(0, capturedAt - lastFrameAt) }
}

window.captureWorker.onRequest(request => {
  void (async () => {
    if (request.kind === 'start') {
      const dimensions = await start()
      return { kind: 'started' as const, ...dimensions }
    } else if (request.kind === 'stop') {
      stop()
      return { kind: 'stopped' as const }
    } else if (request.kind === 'grab') return { kind: 'frame' as const, ...grab() }
    else throw new Error(`Unknown capture request: ${JSON.stringify(request)}`)
  })().then(
    result => window.captureWorker.respond({ requestId: request.requestId, ok: true, result }),
    (error: unknown) => window.captureWorker.respond({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
})
