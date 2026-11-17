import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { appendFileSync, existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { api, json } from './api'
import { openDatabase } from './db'
import { startSampling } from './metrics'
import { protectPaths } from './paths'
import { selfTest } from './selftest'
import { setupUpdates } from './updater'

const ORIGIN = 'app://balai'
const rendererDir = join(__dirname, 'renderer')

const HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const testOutput = process.argv.find((arg) => arg.startsWith('--self-test='))?.slice('--self-test='.length)

if (testOutput) {
  // Test machines have no usable GPU, and the test does not need one.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  // A self-test has no window to show an error in, so failures go to a file next to the report.
  const report = (error: unknown) => {
    try {
      appendFileSync(`${testOutput}.error`, `${error instanceof Error ? error.stack : String(error)}\n`)
    } catch {
      // Nothing more can be done.
    }
    app.exit(2)
  }
  process.on('uncaughtException', report)
  process.on('unhandledRejection', report)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.setAppUserModelId('com.toscanitenekeu.balai')
Menu.setApplicationMenu(null)

let window: BrowserWindow | null = null

function ownPids(): number[] {
  return [process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== 'balai') return new Response('Not found', { status: 404 })

  if (url.pathname.startsWith('/api/')) {
    try {
      const response = await api(request, ownPids)
      for (const [key, value] of Object.entries(HEADERS)) response.headers.set(key, value)
      return response
    } catch (error) {
      console.error(error)
      return json({ ok: false, message: 'Something went wrong inside Balai.' }, 500)
    }
  }

  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]*\.\.[/\\])+/, '')
  const file = join(rendererDir, requested)
  const inside = file.startsWith(rendererDir)
  const target = inside && requested.length > 1 && existsSync(file) ? file : join(rendererDir, 'index.html')
  const response = await net.fetch(pathToFileURL(target).toString())
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Balai',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => (window = null))

  // Balai only ever shows its own pages; links to the web open in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault()
  })

  void window.loadURL(`${ORIGIN}/`)
}

app.on('second-instance', () => {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('window-all-closed', () => app.quit())

app.whenReady().then(async () => {
  openDatabase(app.getPath('userData'))
  protectPaths([app.getPath('userData'), join(process.execPath, '..')])

  protocol.handle('app', handle)

  if (testOutput) {
    const code = await selfTest(testOutput, `${ORIGIN}/`)
    app.exit(code)
    return
  }

  startSampling()
  setupUpdates()
  createWindow()
})
