import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, lstat, mkdir, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export type AgentKind = 'claude' | 'codex'

export type SkillInstallResult =
  | { agent: AgentKind; status: 'not_detected' }
  | { agent: AgentKind; status: 'installed' | 'updated' | 'current'; linkPath: string; targetPath: string }
  | { agent: AgentKind; status: 'conflict'; linkPath: string; reason: string }
  | { agent: AgentKind; status: 'failed'; reason: string }

export interface SkillInstallerOptions {
  bundleRoot: string
  stateRoot: string
  userHome?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  commandExists?: (command: AgentKind) => Promise<boolean>
}

interface AgentLocation {
  agent: AgentKind
  detected: boolean
  skillsRoot: string
}

interface BundleFile {
  absolute: string
  relative: string
  data: Buffer
}

const agents: readonly AgentKind[] = ['claude', 'codex']
const markerName = '.screenmcp-skill-payload.json'

export async function installBundledAgentSkills(options: SkillInstallerOptions): Promise<SkillInstallResult[]> {
  const userHome = options.userHome ?? homedir()
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.commandExists ?? (command => commandExistsOnPath(command, platform, env, userHome))
  const locations = await Promise.all(agents.map(agent => resolveAgentLocation(agent, userHome, env, exists)))
  const detected = locations.filter(location => location.detected)
  if (detected.length === 0) return locations.map(location => ({ agent: location.agent, status: 'not_detected' }))

  let payload: { root: string; hash: string }
  try {
    payload = await materializePayload(options.bundleRoot, options.stateRoot, detected.map(location => location.agent))
  } catch (error) {
    const reason = errorMessage(error)
    return locations.map(location => location.detected ? { agent: location.agent, status: 'failed', reason } : { agent: location.agent, status: 'not_detected' })
  }

  const results: SkillInstallResult[] = []
  for (const location of locations) {
    if (!location.detected) {
      results.push({ agent: location.agent, status: 'not_detected' })
      continue
    }
    const linkPath = join(location.skillsRoot, 'screenmcp')
    const targetPath = join(payload.root, location.agent, 'screenmcp')
    try {
      results.push(await ensureManagedLink(location.agent, linkPath, targetPath, join(options.stateRoot, 'skill-payloads'), platform))
    } catch (error) {
      results.push({ agent: location.agent, status: 'failed', reason: errorMessage(error) })
    }
  }
  return results
}

export async function commandExistsOnPath(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, userHome = homedir()): Promise<boolean> {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? ''
  const separator = platform === 'win32' ? ';' : ':'
  const directories = pathValue.split(separator).map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
  directories.push(join(userHome, '.local', 'bin'))
  if (platform !== 'win32') directories.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin')
  const extensions = platform === 'win32' ? windowsExtensions(env.PATHEXT) : ['']
  const direct = isAbsolute(command) || command.includes('/') || command.includes('\\')
  const candidates = direct
    ? extensions.map(extension => extension && !command.toLowerCase().endsWith(extension.toLowerCase()) ? `${command}${extension}` : command)
    : directories.flatMap(directory => extensions.map(extension => join(directory, `${command}${extension}`)))
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      if ((await stat(candidate)).isFile()) return true
    } catch { continue }
  }
  return false
}

async function resolveAgentLocation(agent: AgentKind, userHome: string, env: NodeJS.ProcessEnv, commandExists: (command: AgentKind) => Promise<boolean>): Promise<AgentLocation> {
  if (agent === 'claude') {
    const home = env.CLAUDE_CONFIG_DIR ?? join(userHome, '.claude')
    return { agent, detected: await pathExists(home) || await commandExists(agent), skillsRoot: join(home, 'skills') }
  } else if (agent === 'codex') {
    const codexHome = env.CODEX_HOME ?? join(userHome, '.codex')
    const skillsRoot = await codexSkillsRoot(userHome, env)
    return { agent, detected: await pathExists(codexHome) || await pathExists(join(userHome, '.agents')) || await commandExists(agent), skillsRoot }
  } else
    throw new Error(`Unknown agent: ${JSON.stringify(agent)}`)
}

async function codexSkillsRoot(userHome: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (env.CODEX_HOME) return join(env.CODEX_HOME, 'skills')
  const current = join(userHome, '.agents', 'skills')
  if (await pathExists(current)) return current
  const compatible = join(userHome, '.codex', 'skills')
  if (await pathExists(compatible)) return compatible
  return current
}

async function materializePayload(bundleRoot: string, stateRoot: string, detectedAgents: AgentKind[]): Promise<{ root: string; hash: string }> {
  const files = await bundleFiles(bundleRoot, detectedAgents)
  const hash = hashFiles(files)
  const payloadsRoot = join(stateRoot, 'skill-payloads')
  const payloadRoot = join(payloadsRoot, hash)
  if (await validPayload(payloadRoot, hash)) return { root: payloadRoot, hash }
  if (await pathExists(payloadRoot)) throw new Error(`Unmanaged skill payload already exists at ${payloadRoot}`)

  await mkdir(payloadsRoot, { recursive: true })
  const staging = join(payloadsRoot, `.staging-${process.pid}-${randomUUID()}`)
  try {
    for (const file of files) {
      const destination = join(staging, file.relative)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(file.absolute, destination)
    }
    await writeFile(join(staging, markerName), `${JSON.stringify({ schema: 1, hash, agents: detectedAgents }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(staging, payloadRoot)
    } catch (error) {
      if (!await validPayload(payloadRoot, hash)) throw error
      await rm(staging, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { root: payloadRoot, hash }
}

async function bundleFiles(bundleRoot: string, detectedAgents: AgentKind[]): Promise<BundleFile[]> {
  const roots = [join(bundleRoot, 'shared', 'register.mjs'), ...detectedAgents.map(agent => join(bundleRoot, agent, 'screenmcp'))]
  const files: BundleFile[] = []
  for (const root of roots) await collectFiles(bundleRoot, root, files)
  files.sort((left, right) => left.relative.localeCompare(right.relative))
  return files
}

async function collectFiles(bundleRoot: string, current: string, output: BundleFile[]): Promise<void> {
  const info = await lstat(current)
  if (info.isSymbolicLink()) throw new Error(`Bundled skill entry cannot be a link: ${current}`)
  if (info.isFile()) {
    output.push({ absolute: current, relative: relative(bundleRoot, current), data: await readFile(current) })
    return
  }
  if (!info.isDirectory()) throw new Error(`Unsupported bundled skill entry: ${current}`)
  for (const entry of await readdir(current)) await collectFiles(bundleRoot, join(current, entry), output)
}

function hashFiles(files: BundleFile[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relative.replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(file.data)
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function validPayload(root: string, hash: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(root, markerName), 'utf8')) as unknown
    return Boolean(marker && typeof marker === 'object' && 'schema' in marker && marker.schema === 1 && 'hash' in marker && marker.hash === hash)
  } catch {
    return false
  }
}

async function ensureManagedLink(agent: AgentKind, linkPath: string, targetPath: string, payloadsRoot: string, platform: NodeJS.Platform): Promise<SkillInstallResult> {
  await mkdir(dirname(linkPath), { recursive: true })
  const canonicalTarget = await realpath(targetPath)
  const canonicalPayloadsRoot = await realpath(payloadsRoot)
  let previousTarget: string | null = null
  try {
    const info = await lstat(linkPath)
    if (!info.isSymbolicLink()) return { agent, status: 'conflict', linkPath, reason: 'A real file or directory already exists.' }
    previousTarget = resolve(dirname(linkPath), await readlink(linkPath))
    const canonicalPrevious = await canonicalPath(previousTarget)
    if (samePath(canonicalPrevious, canonicalTarget, platform)) return { agent, status: 'current', linkPath, targetPath }
    if (!isInside(canonicalPayloadsRoot, canonicalPrevious, platform) && !isInside(payloadsRoot, previousTarget, platform)) return { agent, status: 'conflict', linkPath, reason: `Existing link points outside ScreenMCP: ${previousTarget}` }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  const temporary = `${linkPath}.screenmcp-${process.pid}-${randomUUID()}`
  const linkType = platform === 'win32' ? 'junction' : 'dir'
  await symlink(targetPath, temporary, linkType)
  try {
    if (previousTarget) await rm(linkPath, { recursive: true, force: true })
    await rename(temporary, linkPath)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    if (previousTarget && !await pathExists(linkPath)) {
      try { await symlink(previousTarget, linkPath, linkType) }
      catch (restoreError) { throw new AggregateError([error, restoreError], `Could not update or restore ${linkPath}`, { cause: restoreError }) }
    }
    throw error
  }
  const resolved = await realpath(linkPath)
  if (!samePath(resolved, canonicalTarget, platform)) throw new Error(`Installed skill link resolves to ${resolved}, expected ${canonicalTarget}`)
  return { agent, status: previousTarget ? 'updated' : 'installed', linkPath, targetPath }
}

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path) }
  catch { return resolve(path) }
}

function windowsExtensions(value: string | undefined): string[] {
  const extensions = (value ?? '.COM;.EXE;.BAT;.CMD').split(';').map(extension => extension.trim()).filter(Boolean)
  const normalized = extensions.map(extension => extension.startsWith('.') ? extension : `.${extension}`)
  if (!normalized.some(extension => extension.toLowerCase() === '.ps1')) normalized.push('.PS1')
  return ['', ...normalized]
}

function isInside(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const parentPath = comparablePath(resolve(parent), platform)
  const childPath = comparablePath(resolve(child), platform)
  return childPath.startsWith(`${parentPath}${sep}`)
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return comparablePath(resolve(left), platform) === comparablePath(resolve(right), platform)
}

function comparablePath(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.toLowerCase() : path
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
