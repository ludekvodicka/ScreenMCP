import type { UpdateChannel, UpdateSettings } from '../../shared/contracts'

export interface UpdateRuntimeFacts {
  packaged: boolean
  platform: NodeJS.Platform
  portable: boolean
  settings: UpdateSettings
}

export interface UpdateResolution {
  channel: UpdateChannel
  reason: string
  autoCheck: boolean
  checkIntervalMinutes: number
}

export function resolveUpdateRuntime(facts: UpdateRuntimeFacts): UpdateResolution {
  let channel: UpdateChannel
  let reason: string
  if (!facts.packaged) {
    channel = 'none'
    reason = 'Development run — install a packaged release to use automatic updates.'
  } else if (facts.platform === 'darwin') {
    channel = 'none'
    reason = 'Unsigned macOS build — download updates manually until ScreenMCP is signed and notarized.'
  } else if (facts.platform === 'win32' && facts.portable) {
    channel = 'none'
    reason = 'Windows Portable build — replace the portable executable manually from GitHub Releases.'
  } else if (facts.platform === 'win32') {
    channel = 'github'
    reason = 'Installed Windows build — updates come from GitHub Releases.'
  } else if (facts.platform === 'linux') {
    channel = 'github'
    reason = 'Packaged Linux build — updates come from GitHub Releases.'
  } else
    throw new Error(`Unsupported update platform: ${JSON.stringify(facts.platform)}`)
  return {
    channel,
    reason,
    autoCheck: facts.settings.autoCheck,
    checkIntervalMinutes: facts.settings.checkIntervalMinutes,
  }
}
