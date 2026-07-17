import sharp from 'sharp'
import { dhash } from './dhash'
import { targetDimensions } from './downscale'
import type { EncodedFrame, FramePolicy, PreparedFrame, RawFrame } from './types'

export function isNearlyBlack(rgba: Uint8Array): boolean {
  if (rgba.length === 0) return true
  let visible = 0
  let bright = 0
  const pixels = rgba.length / 4
  const stride = Math.max(1, Math.floor(pixels / 4096))
  for (let pixel = 0; pixel < pixels; pixel += stride) {
    const index = pixel * 4
    visible++
    if ((rgba[index] ?? 0) + (rgba[index + 1] ?? 0) + (rgba[index + 2] ?? 0) > 30) bright++
  }
  return bright / visible < 0.005
}

export async function prepareFrame(frame: RawFrame, maxLongSide: number | null): Promise<PreparedFrame> {
  const target = targetDimensions(frame.width, frame.height, maxLongSide)
  const input = sharp(Buffer.from(frame.rgba), { raw: { width: frame.width, height: frame.height, channels: 4 } })
  const resized = target.width === frame.width && target.height === frame.height ? input : input.resize(target.width, target.height, { fit: 'fill' })
  const { data: raw, info } = await resized.raw().toBuffer({ resolveWithObject: true })
  return {
    rgba: raw,
    width: info.width,
    height: info.height,
    hash: dhash(raw, info.width, info.height),
    capturedAt: frame.capturedAt,
    frameAgeMs: frame.frameAgeMs,
    nearlyBlack: isNearlyBlack(raw),
  }
}

export async function encodePreparedFrame(frame: PreparedFrame, policy: FramePolicy): Promise<EncodedFrame> {
  const encoder = sharp(Buffer.from(frame.rgba), { raw: { width: frame.width, height: frame.height, channels: 4 } })
  let data: Buffer
  if (policy.format === 'jpeg') data = await encoder.jpeg({ quality: policy.jpegQuality, chromaSubsampling: '4:4:4' }).toBuffer()
  else if (policy.format === 'png') data = await encoder.png().toBuffer()
  else throw new Error(`Unknown frame format: ${JSON.stringify(policy.format)}`)
  return {
    data,
    format: policy.format,
    width: frame.width,
    height: frame.height,
    hash: frame.hash,
    capturedAt: frame.capturedAt,
    frameAgeMs: frame.frameAgeMs,
    nearlyBlack: frame.nearlyBlack,
  }
}

export async function encodeFrame(frame: RawFrame, policy: FramePolicy): Promise<EncodedFrame> {
  return encodePreparedFrame(await prepareFrame(frame, policy.maxLongSide), policy)
}
