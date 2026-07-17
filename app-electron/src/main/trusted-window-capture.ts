export interface TrustedWindowCaptureSource {
  kind: 'verified-unlisted-window'
  id: string
  name: string
}

export function validateTrustedWindowCapture(sourceId: string, source: TrustedWindowCaptureSource, platform: NodeJS.Platform): TrustedWindowCaptureSource {
  if (source.kind === 'verified-unlisted-window') {
    const match = /^window:(\d+):0$/.exec(source.id)
    const nativeId = match ? BigInt(match[1]!) : 0n
    if (platform !== 'win32' || source.id !== sourceId || nativeId < 1n || nativeId > 0xffff_ffffn) throw new Error(`Invalid trusted window capture source: ${JSON.stringify(source)}`)
    return { ...source, name: source.name.trim() || 'Dialog' }
  } else throw new Error(`Unknown trusted capture source: ${JSON.stringify(source)}`)
}
