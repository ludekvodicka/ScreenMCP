#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function readEndpoint(path = join(process.env.SCREENMCP_HOME ?? join(homedir(), '.screenmcp'), 'endpoint.json')) {
  let value
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`ScreenMCP endpoint not found at ${path}. Start the ScreenMCP app first.`, { cause: error })
    if (error instanceof SyntaxError) throw new Error(`ScreenMCP endpoint is invalid JSON: ${path}`, { cause: error })
    throw error
  }
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.token !== 'string') throw new Error(`ScreenMCP endpoint is missing url or token: ${path}`)
  const url = new URL(value.url)
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || url.pathname !== '/mcp') throw new Error(`ScreenMCP endpoint must be a localhost HTTP /mcp URL: ${value.url}`)
  if (value.token.length < 32) throw new Error('ScreenMCP endpoint token is unexpectedly short. Restart ScreenMCP to regenerate it.')
  return { url: url.href, token: value.token }
}

export function claudeArgs(endpoint) {
  return ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'screenmcp', endpoint.url, '--header', `Authorization: Bearer ${endpoint.token}`]
}

export function upsertCodexConfig(source, endpoint) {
  const section = `[mcp_servers.screenmcp]\nurl = ${JSON.stringify(endpoint.url)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${endpoint.token}`)} }\n`
  const header = /^\[mcp_servers\.screenmcp\][ \t]*$/m
  const match = header.exec(source)
  if (!match) return `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${section}`
  const remainder = source.slice(match.index + match[0].length)
  const next = /^\[[^\]]+\][ \t]*$/m.exec(remainder)
  const end = next ? match.index + match[0].length + next.index : source.length
  return `${source.slice(0, match.index).trimEnd()}${match.index ? '\n\n' : ''}${section}${source.slice(end).replace(/^\s+/, '\n')}`
}

export async function writeCodexConfig(endpoint, path = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml')) {
  let source = ''
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const output = upsertCodexConfig(source, endpoint)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export function registerClaude(endpoint, executable = process.env.SCREENMCP_CLAUDE_BIN ?? 'claude', run = runAgentCommand) {
  run(executable, ['mcp', 'remove', '--scope', 'user', 'screenmcp'], { stdio: 'ignore' })
  const result = run(executable, claudeArgs(endpoint), { stdio: 'inherit' })
  if (result.error) throw new Error(`Could not run Claude Code CLI: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Claude Code registration failed with exit code ${result.status ?? 'unknown'}`)
}

export function runAgentCommand(executable, args, options) {
  if (process.platform !== 'win32') return spawnSync(executable, args, options)
  const resolved = resolveWindowsExecutable(executable)
  if (!['.cmd', '.bat'].includes(extname(resolved).toLowerCase())) return spawnSync(resolved, args, options)
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'call', resolved, ...args], options)
}

function resolveWindowsExecutable(executable) {
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(value => value.trim()).filter(Boolean)
  const direct = isAbsolute(executable) || executable.includes('/') || executable.includes('\\')
  const directories = direct ? [''] : (process.env.PATH ?? '').split(delimiter).map(value => value.replace(/^"|"$/g, '')).filter(Boolean)
  const candidates = directories.flatMap(directory => {
    const base = directory ? join(directory, executable) : executable
    if (extname(base)) return [base]
    return extensions.map(extension => `${base}${extension.startsWith('.') ? extension : `.${extension}`}`)
  })
  for (const candidate of candidates) {
    try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate }
    catch { continue }
  }
  return executable
}

export async function main(target = process.argv[2]) {
  const endpoint = await readEndpoint()
  if (target === 'claude') registerClaude(endpoint)
  else if (target === 'codex') await writeCodexConfig(endpoint)
  else throw new Error(`Unknown registration target: ${JSON.stringify(target)}. Use "claude" or "codex".`)
  console.log(`Registered ScreenMCP for ${target} at ${endpoint.url}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
