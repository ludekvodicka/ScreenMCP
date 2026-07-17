import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandExistsOnPath, installBundledAgentSkills, type AgentKind, type SkillInstallResult } from './skill-installer'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('skill installer', () => {
  it('installs Claude and Codex links and is idempotent', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const stateRoot = join(root, 'state')
    await mkdir(join(userHome, '.claude'), { recursive: true })
    await mkdir(join(userHome, '.codex', 'skills'), { recursive: true })

    const first = await installBundledAgentSkills(options(bundleRoot, stateRoot, userHome))
    expect(status(first, 'claude')).toBe('installed')
    expect(status(first, 'codex')).toBe('installed')
    const claudeLink = join(userHome, '.claude', 'skills', 'screenmcp')
    const codexLink = join(userHome, '.codex', 'skills', 'screenmcp')
    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true)
    expect((await lstat(codexLink)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(claudeLink, 'SKILL.md'), 'utf8')).toBe('claude-v1')
    expect(await readFile(join(codexLink, 'SKILL.md'), 'utf8')).toBe('codex-v1')
    expect(await readFile(join(claudeLink, 'register.mjs'), 'utf8')).toContain('../../shared/register.mjs')

    const second = await installBundledAgentSkills(options(bundleRoot, stateRoot, userHome))
    expect(status(second, 'claude')).toBe('current')
    expect(status(second, 'codex')).toBe('current')
  })

  it('repairs a ScreenMCP-managed link when the bundled payload changes', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const stateRoot = join(root, 'state')
    await mkdir(join(userHome, '.claude'), { recursive: true })
    const first = await installBundledAgentSkills(options(bundleRoot, stateRoot, userHome))
    const link = join(userHome, '.claude', 'skills', 'screenmcp')
    const firstTarget = await realpath(link)
    expect(status(first, 'claude')).toBe('installed')

    await writeFile(join(bundleRoot, 'claude', 'screenmcp', 'SKILL.md'), 'claude-v2')
    const second = await installBundledAgentSkills(options(bundleRoot, stateRoot, userHome))
    expect(status(second, 'claude')).toBe('updated')
    expect(await realpath(link)).not.toBe(firstTarget)
    expect(await readFile(join(link, 'SKILL.md'), 'utf8')).toBe('claude-v2')
    expect(await readFile(join(firstTarget, 'SKILL.md'), 'utf8')).toBe('claude-v1')
  })

  it('preserves an existing real skill directory as a conflict', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const stateRoot = join(root, 'state')
    const existing = join(userHome, '.claude', 'skills', 'screenmcp')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, 'owner.txt'), 'user')

    const results = await installBundledAgentSkills(options(bundleRoot, stateRoot, userHome))
    expect(status(results, 'claude')).toBe('conflict')
    expect(await readFile(join(existing, 'owner.txt'), 'utf8')).toBe('user')
    expect((await lstat(existing)).isDirectory()).toBe(true)
  })

  it('preserves a foreign skill link as a conflict', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const foreign = join(root, 'foreign')
    const link = join(userHome, '.claude', 'skills', 'screenmcp')
    await mkdir(foreign, { recursive: true })
    await mkdir(join(userHome, '.claude', 'skills'), { recursive: true })
    await symlink(foreign, link, process.platform === 'win32' ? 'junction' : 'dir')

    const results = await installBundledAgentSkills(options(bundleRoot, join(root, 'state'), userHome))
    expect(status(results, 'claude')).toBe('conflict')
    expect(await realpath(link)).toBe(await realpath(foreign))
  })

  it('does nothing when neither agent is detected', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const stateRoot = join(root, 'state')
    const results = await installBundledAgentSkills(options(bundleRoot, stateRoot, join(root, 'user')))
    expect(results).toEqual([{ agent: 'claude', status: 'not_detected' }, { agent: 'codex', status: 'not_detected' }])
    await expect(lstat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses an explicit CODEX_HOME skill directory', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const codexHome = join(root, 'custom-codex')
    await mkdir(codexHome, { recursive: true })
    const results = await installBundledAgentSkills({ ...options(bundleRoot, join(root, 'state'), userHome), env: { CODEX_HOME: codexHome } })
    expect(status(results, 'codex')).toBe('installed')
    expect((await lstat(join(codexHome, 'skills', 'screenmcp'))).isSymbolicLink()).toBe(true)
  })

  it('uses the current personal Codex skill root for a command-only installation', async () => {
    const root = await temporaryRoot()
    const bundleRoot = await createBundle(root)
    const userHome = join(root, 'user')
    const results = await installBundledAgentSkills({
      ...options(bundleRoot, join(root, 'state'), userHome),
      commandExists: agent => Promise.resolve(agent === 'codex'),
    })
    expect(status(results, 'codex')).toBe('installed')
    expect((await lstat(join(userHome, '.agents', 'skills', 'screenmcp'))).isSymbolicLink()).toBe(true)
  })

  it('returns a failure without throwing when bundled files are missing', async () => {
    const root = await temporaryRoot()
    const userHome = join(root, 'user')
    await mkdir(join(userHome, '.claude'), { recursive: true })
    const results = await installBundledAgentSkills(options(join(root, 'missing'), join(root, 'state'), userHome))
    expect(status(results, 'claude')).toBe('failed')
    expect(status(results, 'codex')).toBe('not_detected')
  })

  it('detects Windows command shims from PATH', async () => {
    const root = await temporaryRoot()
    const binary = join(root, 'bin')
    await mkdir(binary, { recursive: true })
    // PATHEXT case must match the shim on disk: CI runs on a case-sensitive filesystem, where a
    // lookup for "codex.CMD" would miss a "codex.cmd" file — Windows (case-insensitive) never does.
    await writeFile(join(binary, 'codex.cmd'), '@exit /b 0')
    await expect(commandExistsOnPath('codex', 'win32', { PATH: binary, PATHEXT: '.cmd' }, join(root, 'user'))).resolves.toBe(true)
    await expect(commandExistsOnPath('claude', 'win32', { PATH: binary, PATHEXT: '.cmd' }, join(root, 'user'))).resolves.toBe(false)
  })
})

function options(bundleRoot: string, stateRoot: string, userHome: string) {
  return { bundleRoot, stateRoot, userHome, platform: process.platform, env: {}, commandExists: () => Promise.resolve(false) }
}

function status(results: SkillInstallResult[], agent: AgentKind): SkillInstallResult['status'] | undefined {
  return results.find(result => result.agent === agent)?.status
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'screenmcp-skills-'))
  temporaryDirectories.push(root)
  return root
}

async function createBundle(root: string): Promise<string> {
  const bundle = join(root, 'bundle')
  await mkdir(join(bundle, 'shared'), { recursive: true })
  await writeFile(join(bundle, 'shared', 'register.mjs'), 'export const shared = true')
  for (const agent of ['claude', 'codex'] as const) {
    const skill = join(bundle, agent, 'screenmcp')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), `${agent}-v1`)
    await writeFile(join(skill, 'register.mjs'), `import '../../shared/register.mjs'`)
  }
  return resolve(bundle)
}
