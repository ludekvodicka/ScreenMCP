import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeArgs, readEndpoint, registerClaude, upsertCodexConfig, writeCodexConfig } from './register.mjs'

const directories = []

afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('ScreenMCP registration', () => {
  it('builds the current Claude HTTP registration shape', () => {
    const endpoint = { url: 'http://127.0.0.1:47210/mcp', token: 'a'.repeat(48) }
    expect(claudeArgs(endpoint)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'screenmcp', endpoint.url, '--header', `Authorization: Bearer ${endpoint.token}`])
  })

  it('passes both Claude commands through the cross-platform runner', () => {
    const endpoint = { url: 'http://127.0.0.1:47210/mcp', token: 'a'.repeat(48) }
    const calls = []
    registerClaude(endpoint, 'claude', (...args) => { calls.push(args); return { status: 0 } })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(['claude', ['mcp', 'remove', '--scope', 'user', 'screenmcp'], { stdio: 'ignore' }])
    expect(calls[1]).toEqual(['claude', claudeArgs(endpoint), { stdio: 'inherit' }])
  })

  it.runIf(process.platform === 'win32')('executes a Windows cmd shim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-register-cmd-'))
    directories.push(directory)
    const shimDirectory = join(directory, 'with space')
    const output = join(directory, 'args.txt')
    const executable = join(shimDirectory, 'claude.cmd')
    await mkdir(shimDirectory)
    await writeFile(executable, `@echo off\r\n:loop\r\nif "%~1"=="" goto done\r\n>>"${output}" echo [%~1]\r\nshift\r\ngoto loop\r\n:done\r\nexit /b 0\r\n`)
    const endpoint = { url: 'http://127.0.0.1:47210/mcp', token: 'a'.repeat(48) }
    expect(() => registerClaude(endpoint, executable)).not.toThrow()
    const argumentsSeen = await readFile(output, 'utf8')
    expect(argumentsSeen).toContain(`[${endpoint.url}]`)
    expect(argumentsSeen).toContain(`[Authorization: Bearer ${endpoint.token}]`)
  })

  it('upserts only the ScreenMCP Codex table', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-register-'))
    directories.push(directory)
    const path = join(directory, 'config.toml')
    const original = '[model_providers.local]\nname = "Local"\n\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n'
    await writeFile(path, upsertCodexConfig(original, { url: 'http://127.0.0.1:1/mcp', token: 'a'.repeat(48) }))
    await writeCodexConfig({ url: 'http://127.0.0.1:2/mcp', token: 'b'.repeat(48) }, path)
    const output = await readFile(path, 'utf8')
    expect(output).toContain('[model_providers.local]')
    expect(output).toContain('[mcp_servers.other]')
    expect(output.match(/\[mcp_servers\.screenmcp\]/g)).toHaveLength(1)
    expect(output).toContain('http://127.0.0.1:2/mcp')
    expect(output).not.toContain('http://127.0.0.1:1/mcp')
  })

  it('fails clearly when endpoint.json is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'screenmcp-register-missing-'))
    directories.push(directory)
    await expect(readEndpoint(join(directory, 'endpoint.json'))).rejects.toThrow('Start the ScreenMCP app first')
  })
})
