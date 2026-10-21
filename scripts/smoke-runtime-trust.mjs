import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

const [executable, report] = process.argv.slice(2)
if (!executable || !report)
  throw new Error('usage: node scripts/smoke-runtime-trust.mjs <packaged executable> <report.json>')

const output = resolve(report)
const profile = join(dirname(output), `runtime-profile-${Date.now()}`)
await mkdir(profile, { recursive: true })
await mkdir(join(profile, 'screenmcp'))
await writeFile(join(profile, 'screenmcp/settings.json'), JSON.stringify({ updates: { autoCheck: false } }))
const env = {
  ...process.env,
  SCREENMCP_HOME: join(profile, 'screenmcp'),
  CLAUDE_CONFIG_DIR: join(profile, 'claude'),
  CODEX_HOME: join(profile, 'codex'),
}
delete env.ELECTRON_RUN_AS_NODE
delete env.SCREENMCP_CAPTURE_SMOKE
const reservation = createServer()
await new Promise((resolvePort, reject) => {
  reservation.once('error', reject)
  reservation.listen(0, '127.0.0.1', resolvePort)
})
const port = reservation.address().port
await new Promise(resolveClose => reservation.close(resolveClose))
const child = spawn(resolve(executable), [`--inspect=127.0.0.1:${port}`, `--user-data-dir=${join(profile, 'electron')}`], {
  env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
let socket
let sequence = 0
let spawnError
child.on('error', error => { spawnError = error })
child.stdout.on('data', data => { log += data })
child.stderr.on('data', data => { log += data })
const pending = new Map()
const exit = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
const deadline = setTimeout(() => {
  console.error('Packaged runtime smoke exceeded 90 seconds')
  stopChild()
}, 90_000)

function stopChild() {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    else
      child.kill()
  }
}

function command(method, params = {}) {
  const id = ++sequence
  return new Promise((resolveCommand, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)) }, 60_000)
    pending.set(id, { resolve: resolveCommand, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

try {
  let endpoint
  // Portable launchers do not forward the child's stderr, including its inspector URL.
  for (let attempt = 0; attempt < 300; attempt++) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null) throw new Error(`App exited before inspector: ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
      endpoint = (await response.json())[0]?.webSocketDebuggerUrl
      if (endpoint) break
    } catch { /* The child has not opened its inspector yet. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  if (!endpoint) throw new Error('Packaged inspector did not become available')
  socket = new WebSocket(endpoint)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const callback = pending.get(message.id)
    if (!callback) return
    pending.delete(message.id)
    clearTimeout(callback.timer)
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
    else callback.resolve(message.result)
  })
  const identity = await command('Runtime.evaluate', { expression: 'process.env.SCREENMCP_HOME', returnByValue: true })
  if (identity.result.value !== env.SCREENMCP_HOME) throw new Error('Inspector does not belong to this smoke process')
  const evaluation = await command('Runtime.evaluate', {
    expression: `globalThis.screenMcpRuntimeSmoke = (${probePackagedRuntime.toString()})()`, awaitPromise: true, returnByValue: true,
  })
  if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails))
  const result = evaluation.result.value
  const application = await command('Runtime.evaluate', {
    expression: `globalThis.screenMcpApplicationSmoke = (${probePackagedApplication.toString()})()`, awaitPromise: true, returnByValue: true,
  })
  if (application.exceptionDetails) throw new Error(JSON.stringify(application.exceptionDetails))
  result.application = application.result.value
  result.passed &&= result.application.passed
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  await command('Runtime.evaluate', {
    expression: 'setTimeout(() => process.getBuiltinModule("module").createRequire(process.resourcesPath + "/app.asar/package.json")("electron").app.exit(0), 100)',
  })
  socket.close()
  const ended = await exit
  if (!result.passed || ended.code !== 0) throw new Error(`Runtime trust smoke failed: ${output}; exit=${ended.code}`)
  console.log(`Packaged ScreenMCP ${result.version}, Electron ${result.versions.electron}: ${result.results.length} hosts x 4 clients passed; ${output}`)
} finally {
  socket?.close()
  stopChild()
  clearTimeout(deadline)
  for (const callback of pending.values()) clearTimeout(callback.timer)
  await writeFile(`${output}.log`, log)
}

async function probePackagedApplication() {
  const require = process.getBuiltinModule('module').createRequire(`${process.resourcesPath}/app.asar/package.json`)
  const { BrowserWindow } = require('electron')
  const fs = require('node:fs')
  const sharp = require('sharp')
  let ui
  for (let attempt = 0; attempt < 100; attempt++) {
    ui = BrowserWindow.getAllWindows().find(window => /\/renderer\/index\.html$/.test(window.webContents.getURL()))
    if (ui && !ui.webContents.isLoading()) break
    await new Promise(resolveWait => setTimeout(resolveWait, 200))
  }
  if (!ui) throw new Error('Packaged UI did not initialize')
  const endpoint = JSON.parse(fs.readFileSync(`${process.env.SCREENMCP_HOME}/endpoint.json`, 'utf8'))
  const health = endpoint.url.replace(/\/mcp$/, '/health')
  const authorization = `Bearer ${endpoint.token}`
  const access = {
    loopback: new URL(health).hostname === '127.0.0.1',
    unauthenticated: (await fetch(health)).status,
    browserOrigin: (await fetch(health, { headers: { authorization, origin: 'https://example.test' } })).status,
    authenticated: (await fetch(health, { headers: { authorization } })).status,
  }
  const surface = new BrowserWindow({ width: 640, height: 420, show: true, backgroundColor: '#12618c', title: 'ScreenMCP runtime smoke fixture', webPreferences: { backgroundThrottling: false } })
  let capture
  try {
    await surface.loadURL(`data:text/html,${encodeURIComponent('<title>ScreenMCP runtime smoke fixture</title><body style="margin:0;min-height:100vh;background:#12618c"></body>')}`)
    // Native capture can observe the initial white frame before the compositor paints the document.
    await new Promise(resolvePaint => setTimeout(resolvePaint, 500))
    const fixture = await surface.webContents.capturePage()
    const fixtureRgb = [...await sharp(fixture.toPNG()).extract({ left: 300, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
    const selection = { captureId: surface.getMediaSourceId(), kind: 'window', label: 'ScreenMCP runtime smoke fixture' }
    await ui.webContents.executeJavaScript(`window.screenmcp.selectSource(${JSON.stringify(selection)})`)
    await new Promise(resolveFrame => setTimeout(resolveFrame, 500))
    const frame = await ui.webContents.executeJavaScript('window.screenmcp.getPreview()')
    const pixels = await sharp(Buffer.from(frame.dataUrl.split(',')[1], 'base64'))
      .extract({ left: Math.floor(frame.width / 2), top: Math.floor(frame.height / 2), width: 1, height: 1 })
      .removeAlpha().raw().toBuffer()
    const color = [...pixels]
    capture = {
      width: frame.width, height: frame.height, format: frame.format, centerRgb: color,
      fixtureBackground: await surface.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'),
      fixtureRgb,
      passed: frame.width > 100 && frame.height > 100 && color.every((value, index) => Math.abs(value - [18, 97, 140][index]) < 12),
    }
    await ui.webContents.executeJavaScript('window.screenmcp.clearSource()')
  } finally {
    surface.destroy()
  }
  return {
    access, capture,
    passed: access.loopback && access.unauthenticated === 401 && access.browserOrigin === 403 && access.authenticated === 200 && capture.passed,
  }
}

async function probePackagedRuntime() {
  // Resolve from the shipped archive so this cannot silently test the development dependencies.
  const require = process.getBuiltinModule('module').createRequire(`${process.resourcesPath}/app.asar/package.json`)
  const { app, net, session } = require('electron')
  const https = require('node:https')
  const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor.js')
  const { readFileSync } = require('original-fs')
  const { createHash } = require('node:crypto')
  await app.whenReady()
  const updater = new ElectronHttpExecutor()
  const affected = ['dv', 'ov', 'ev'].flatMap(kind => ['g3b', 'g3c'].flatMap(gen =>
    ['', '-aaa'].map(cross => `${kind}-${gen}${cross}-emudhra.we-have-a-problem.com`)))
  const hosts = [...affected, 'example.com', 'github.com']
  function request(host, factory) {
    return new Promise(resolveRequest => {
      const timer = setTimeout(() => {
        req.abort()
        resolveRequest({ error: 'TIMEOUT' })
      }, 12_000)
      const req = factory({ protocol: 'https:', hostname: host, path: '/', method: 'GET' }, response => {
        response.on('data', () => {})
        response.on('end', () => { clearTimeout(timer); resolveRequest({ status: response.statusCode }) })
      })
      req.on('error', error => { clearTimeout(timer); resolveRequest({ error: error.code ?? error.message }) })
      req.end()
    })
  }
  async function fetchHost(host) {
    try {
      const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(12_000) })
      await response.arrayBuffer()
      return { status: response.status }
    } catch (error) {
      return { error: error.cause?.code ?? error.message }
    }
  }
  const results = await Promise.all(hosts.map(async host => {
    const clients = {
      nodeHttps: await request(host, https.request),
      nodeFetch: await fetchHost(host),
      chromium: await request(host, (options, response) => {
        const req = net.request({ ...options, session: session.defaultSession })
        req.on('response', response)
        return req
      }),
      updater: await request(host, updater.createRequest.bind(updater)),
    }
    const rejected = new Set(['CERT_REVOKED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'net::ERR_CERT_REVOKED', 'net::ERR_CERT_AUTHORITY_INVALID'])
    const passed = Object.values(clients).every(result => affected.includes(host)
      ? rejected.has(result.error) : result.status === 200)
    return { host, affected: affected.includes(host), passed, clients }
  }))
  return {
    at: new Date().toISOString(), version: app.getVersion(), versions: process.versions,
    executable: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged,
    executableSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
    archiveSha256: createHash('sha256').update(readFileSync(app.getAppPath())).digest('hex'),
    updaterVersion: require('electron-updater/package.json').version,
    passed: app.isPackaged && results.every(result => result.passed), results,
  }
}
