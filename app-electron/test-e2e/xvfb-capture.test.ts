import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe.skipIf(process.platform !== 'linux')('X11 capture', () => {
  it('returns a decodable look frame from the rendered Xvfb display', { retry: 2 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-xvfb-'))
    const output = join(directory, 'look.jpg')
    try {
      const child = spawn(require('electron') as string, ['--no-sandbox', '.'], {
        cwd: process.cwd(),
        env: { ...process.env, SCREENMCP_HOME: join(directory, 'home'), SCREENMCP_CAPTURE_SMOKE: output },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk) })
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Electron capture timed out\n${stdout}\n${stderr}`)) }, 110_000)
        child.once('error', reject)
        child.once('close', value => { clearTimeout(timer); resolve(value) })
      })
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      const image = sharp(output)
      const metadata = await image.metadata()
      const stats = await image.stats()
      expect(metadata.format).toBe('jpeg')
      expect(metadata.width).toBeGreaterThan(100)
      expect(metadata.height).toBeGreaterThan(100)
      expect(Math.max(...stats.channels.map(channel => channel.max))).toBeGreaterThan(80)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
