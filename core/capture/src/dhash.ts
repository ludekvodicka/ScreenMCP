function luminance(rgba: Uint8Array, index: number): number {
  return (rgba[index] ?? 0) * 0.299 + (rgba[index + 1] ?? 0) * 0.587 + (rgba[index + 2] ?? 0) * 0.114
}

function sample(rgba: Uint8Array, width: number, height: number, x: number, y: number): number {
  const sourceX = Math.min(width - 1, Math.max(0, Math.round((x / 8) * (width - 1))))
  const sourceY = Math.min(height - 1, Math.max(0, Math.round((y / 7) * (height - 1))))
  return luminance(rgba, (sourceY * width + sourceX) * 4)
}

export function dhash(rgba: Uint8Array, width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError('Invalid frame dimensions')
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA length does not match frame dimensions')
  let hash = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash <<= 1n
      if (sample(rgba, width, height, x, y) > sample(rgba, width, height, x + 1, y)) hash |= 1n
    }
  }
  return hash.toString(16).padStart(16, '0')
}

export function hashDistance(left: string, right: string): number {
  if (!/^[a-f\d]{16}$/i.test(left) || !/^[a-f\d]{16}$/i.test(right)) throw new TypeError('dHash must be 16 hexadecimal characters')
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`)
  let distance = 0
  while (value) {
    value &= value - 1n
    distance++
  }
  return distance
}

