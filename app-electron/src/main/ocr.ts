import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import sharp from 'sharp'
import Tesseract from 'tesseract.js'
import type { PreparedFrame } from '../../../core/capture/src/types'
import type { OcrWord, ReadTextResult, Rect } from '../../../core/mcp/src/control'
import { ScreenMcpError } from '../../../core/mcp/src/errors'
import { configDir } from './paths'

interface RecognizedWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface Recognizer {
  recognize(image: Buffer, options: Record<string, never>, output: { text: true; blocks: true }): Promise<{
    data: { blocks: Array<{ paragraphs: Array<{ lines: Array<{ words: RecognizedWord[] }> }> }> | null }
  }>
  terminate(): Promise<unknown>
}

export interface OcrReaderOptions {
  createRecognizer?: () => Promise<Recognizer>
}

export class OcrReader {
  private recognizer: Promise<Recognizer> | null = null
  private operation: Promise<unknown> = Promise.resolve()
  private createRecognizer: () => Promise<Recognizer>

  constructor(options: OcrReaderOptions = {}) {
    this.createRecognizer = options.createRecognizer ?? createTesseractRecognizer
  }

  readRegion(frame: PreparedFrame, region: Rect): Promise<ReadTextResult> {
    return this.enqueue(async () => {
      const crop = cropPayloadRgba(frame.rgba, frame.width, frame.height, region)
      try {
        const png = await sharp(crop.rgba, { raw: { width: crop.width, height: crop.height, channels: 4 } }).png().toBuffer()
        const { data } = await (await this.worker()).recognize(png, {}, { text: true, blocks: true })
        const words: OcrWord[] = (data.blocks ?? []).flatMap(block => block.paragraphs).flatMap(paragraph => paragraph.lines).flatMap(line => line.words).flatMap(word => {
          const text = word.text.trim()
          if (!text) return []
          return [{
            text,
            x: region.x + word.bbox.x0,
            y: region.y + word.bbox.y0,
            width: Math.max(1, word.bbox.x1 - word.bbox.x0),
            height: Math.max(1, word.bbox.y1 - word.bbox.y0),
          }]
        })
        return { text: words.map(word => word.text).join(' '), words, method: 'ocr' }
      } catch (error) {
        throw new ScreenMcpError('ocr_failed', `Region OCR failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  async dispose(): Promise<void> {
    const current = this.recognizer
    this.recognizer = null
    if (current) await current.then(worker => worker.terminate()).catch(() => undefined)
  }

  private worker(): Promise<Recognizer> {
    this.recognizer ??= this.createRecognizer().catch(error => {
      this.recognizer = null
      throw error
    })
    return this.recognizer
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.operation.then(run, run)
    this.operation = next.catch(() => undefined)
    return next
  }
}

export function cropPayloadRgba(rgba: Uint8Array, width: number, height: number, region: Rect): { rgba: Uint8Array; width: number; height: number } {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match payload dimensions')
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x + region.width > width || region.y + region.height > height)
    throw new ScreenMcpError('out_of_bounds', 'OCR region is outside the selected source')
  const output = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const source = ((region.y + row) * width + region.x) * 4
    output.set(rgba.subarray(source, source + region.width * 4), row * region.width * 4)
  }
  return { rgba: output, width: region.width, height: region.height }
}

async function createTesseractRecognizer(): Promise<Recognizer> {
  const require = createRequire(import.meta.url)
  const data = require('@tesseract.js-data/eng') as { code: string; gzip: boolean; langPath: string }
  const workerPath = unpackedPath(require.resolve('tesseract.js/src/worker-script/node/index.js'))
  const langPath = unpackedPath(data.langPath)
  const cachePath = join(configDir(), 'ocr-cache')
  await mkdir(cachePath, { recursive: true })
  return Tesseract.createWorker(data.code, Tesseract.OEM.LSTM_ONLY, {
    workerPath,
    langPath,
    cachePath,
    gzip: data.gzip,
    logger: () => undefined,
  })
}

function unpackedPath(path: string): string {
  const marker = `${join('resources', 'app.asar')}`
  if (!path.includes(marker)) return path
  const candidate = path.replace(marker, `${join('resources', 'app.asar.unpacked')}`)
  return existsSync(candidate) ? candidate : path
}
