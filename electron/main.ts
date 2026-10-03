import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import path from 'path'
import { existsSync, readFileSync } from 'fs'
import { execSync, spawn, fork, ChildProcess } from 'child_process'
import http from 'http'

let mainWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const DEBUG_PORT = 9222
const SERVER_PORT = 3456
const SERVER_URL = `http://localhost:${SERVER_PORT}`

// Common Electron apps and their paths
const ELECTRON_APPS = [
  { name: 'Slack', path: '/Applications/Slack.app', icon: '💬' },
  { name: 'Discord', path: '/Applications/Discord.app', icon: '🎮' },
  { name: 'VS Code', path: '/Applications/Visual Studio Code.app', icon: '💻' },
  { name: 'Notion', path: '/Applications/Notion.app', icon: '📝' },
  { name: 'Figma', path: '/Applications/Figma.app', icon: '🎨' },
  { name: 'Spotify', path: '/Applications/Spotify.app', icon: '🎵' },
  { name: 'WhatsApp', path: '/Applications/WhatsApp.app', icon: '📱' },
  { name: 'Telegram', path: '/Applications/Telegram.app', icon: '✈️' },
  { name: 'Obsidian', path: '/Applications/Obsidian.app', icon: '🗃️' },
]

// Helper to extract app icon as base64
function extractAppIcon(appPath: string): string | null {
  try {
    const fs = require('fs')
    const iconPath = path.join(appPath, 'Contents/Resources')
    if (!existsSync(iconPath)) return null
    
    const icnsFiles = fs.readdirSync(iconPath).filter((f: string) => f.endsWith('.icns'))
    if (icnsFiles.length === 0) return null
    
    const icnsFile = path.join(iconPath, icnsFiles[0])
    const tempPng = path.join(app.getPath('temp'), `${path.basename(appPath, '.app')}-${Date.now()}.png`)
    
    // Convert .icns to PNG using sips (built-in macOS tool)
    execSync(`sips -s format png "${icnsFile}" --out "${tempPng}" -Z 128 2>/dev/null`, { stdio: 'pipe' })
    
    if (existsSync(tempPng)) {
      const imageBuffer = fs.readFileSync(tempPng)
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
      
      // Clean up temp file
      try { fs.unlinkSync(tempPng) } catch {}
      
      return base64Image
    }
  } catch (err) {
    console.error(`[Modable] Failed to extract icon for ${path.basename(appPath)}:`, err)
  }
  return null
}

// ============ BACKEND LIFECYCLE ============
//
// The renderer is served by server.js and every /api call goes to it, so the
// application is inert without it. Nothing used to start it: development ran
// `node server.js` by hand in another terminal, and a packaged build simply
// opened a window pointed at a port with nothing behind it.
//
// Only a backend this process started is a backend this process may stop — a
// server already listening belongs to whoever launched it (typically a dev
// terminal) and is left running when Modable quits.

let backend: ChildProcess | null = null

/** Is something already answering on the backend port? */
function backendAnswering(timeoutMs = 1000): Promise<boolean> {
  return new Promise(resolve => {
    // 127.0.0.1, not localhost: localhost resolves to ::1 first here.
    const req = http.get(
      { host: '127.0.0.1', port: SERVER_PORT, path: '/api/debugger/status' },
      res => { res.resume(); resolve(true) },
    )
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
  })
}

/** server.js sits next to dist-electron/ in the tree and inside the asar. */
function serverEntry(): string {
  return path.join(__dirname, '..', 'server.js')
}

/**
 * Make sure a backend is listening, starting one if it is not.
 *
 * Resolves once the port answers. Rejects with something worth showing a
 * person if it cannot be made to answer.
 */
async function ensureBackend(): Promise<void> {
  if (await backendAnswering()) {
    console.log('[Modable] Backend already running - adopting it')
    return
  }

  const entry = serverEntry()
  if (!existsSync(entry)) {
    throw new Error(`The backend is missing from this build (looked in ${entry}).`)
  }

  console.log(`[Modable] Starting backend: ${entry}`)
  // fork(), not spawn('node'): a packaged app cannot assume a system Node.
  // Electron sets ELECTRON_RUN_AS_NODE and, on macOS, runs it through the
  // helper executable, so the child is Node and gets no Dock icon of its own.
  const child = fork(entry, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  backend = child

  child.stdout?.on('data', d => process.stdout.write(`[backend] ${d}`))
  child.stderr?.on('data', d => process.stderr.write(`[backend] ${d}`))

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      err ? reject(err) : resolve()
    }

    child.on('message', (msg: { type?: string; message?: string; code?: string }) => {
      if (msg?.type === 'ready') done()
      if (msg?.type === 'error') {
        done(new Error(
          msg.code === 'EADDRINUSE'
            ? `Port ${SERVER_PORT} is taken by another program.`
            : `The backend failed to start: ${msg.message}`,
        ))
      }
    })
    child.on('error', err => done(new Error(`The backend could not be launched: ${err.message}`)))
    child.on('exit', code => done(new Error(`The backend stopped before it was ready (exit ${code}).`)))

    // The handshake is the fast path; polling covers a build whose server.js
    // predates it, so an older backend still satisfies the wait.
    const poll = setInterval(async () => { if (await backendAnswering(500)) done() }, 400)
    const timer = setTimeout(
      () => done(new Error(`The backend did not come up within 20s on port ${SERVER_PORT}.`)),
      20000,
    )
  })

  console.log('[Modable] Backend ready')
}

/** Stop the backend, but only if we were the ones who started it. */
function stopBackend() {
  if (!backend) return
  const child = backend
  backend = null
  console.log('[Modable] Stopping backend')
  try { child.kill() } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    // In dev mode, still use Vite for hot reload
    mainWindow.loadURL(devServerUrl(VITE_DEV_SERVER_URL))
    mainWindow.webContents.openDevTools()
  } else {
    // In production, load from HTTP server
    mainWindow.loadURL(SERVER_URL)
  }
}

/**
 * The dev server URL, pointed at this project's Vite and nobody else's.
 *
 * vite-plugin-electron throws away the configured host and hardcodes the
 * literal string "localhost" (resolveHostname, in its dist/index.js). On this
 * machine localhost resolves to ::1 before 127.0.0.1, and Vite binds only the
 * family it was given — so with `host: '127.0.0.1'` in the config, Modable's
 * dev server is reachable at 127.0.0.1:5174 and nothing at all is listening on
 * [::1]:5174.
 *
 * Nothing, that is, unless another project left a Vite running. Then the two
 * bind the same port in different address families without any conflict being
 * reported, Electron asks for "localhost", gets ::1, and Modable's own window
 * silently renders a completely different application. That is not a
 * hypothetical: it rendered a stranger's dashboard for weeks and read as
 * Modable being broken.
 *
 * Every other network call in this project already rewrites localhost for this
 * exact reason. This one — the one that decides what the window shows — did
 * not.
 */
function devServerUrl(raw: string): string {
  return raw.replace('://localhost:', '://127.0.0.1:')
}

/**
 * Refuse to show an application that is not Modable.
 *
 * The rewrite above fixes the known way the wrong app gets in. This is the
 * backstop for the unknown ones: whatever ends up being served, confirm it is
 * actually this project before handing the user a window, and if it is not,
 * say exactly what answered instead of rendering it as though it were ours.
 * Silently displaying someone else's app is the one outcome worth crashing to
 * avoid — it is indistinguishable, from the outside, from Modable itself having
 * gone wrong.
 */
async function assertServesModable(url: string): Promise<void> {
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.get(url, res => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.setTimeout(8000, () => {
      req.destroy()
      reject(new Error(`nothing answered at ${url} within 8s`))
    })
  })

  if (/<title>\s*Modable\s*<\/title>/i.test(body)) return

  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()
  throw new Error(
    `${url} is serving ${title ? `"${title}"` : 'a different application'}, not Modable.\n\n` +
    `Another project's dev server is on that port. Stop it, or start Modable on a free one, ` +
    `then try again.`,
  )
}

app.whenReady().then(async () => {
  // The window is held back until the backend answers: in production it serves
  // the renderer itself, so opening first would just show a failed page load.
  try {
    await ensureBackend()
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Modable] Backend startup failed:', detail)
    dialog.showErrorBox(
      'Modable could not start',
      `${detail}\n\nModable needs its local backend on port ${SERVER_PORT} to read and modify applications.`,
    )
    app.quit()
    return
  }

  // In dev the window's contents come from Vite, not from our own backend, so
  // the backend being healthy says nothing about what is on that port.
  if (VITE_DEV_SERVER_URL) {
    try {
      await assertServesModable(devServerUrl(VITE_DEV_SERVER_URL))
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      console.error('[Modable] Refusing to open a window:', detail)
      dialog.showErrorBox('Modable could not start', detail)
      app.quit()
      return
    }
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// will-quit fires on every exit path, including Cmd-Q with the window already
// closed, so the child never outlives the app that started it.
app.on('will-quit', stopBackend)
process.on('exit', stopBackend)

// ============ APP DETECTION ============

/**
 * The installed applications, asked of the backend rather than worked out here.
 *
 * This handler used to scan for the apps itself, in a near-copy of the loop in
 * server.js — the same duplication that already bit the injector above. It
 * drifted the moment the backend learned that an application can be reachable
 * without being Electron: server.js started reporting a channel and a real
 * reachability per app, this copy kept answering `isElectron`, and Spotify
 * showed up in the desktop build as permanently "closed" while the web build
 * showed it as ready. Same app, same machine, two answers.
 *
 * There is only one scan now. The backend is already running — nothing gets a
 * window until it is — so proxying costs nothing and cannot fall behind.
 */
ipcMain.handle('apps:getInstalled', async () => {
  try {
    const body = await new Promise<string>((resolve, reject) => {
      // 127.0.0.1, never localhost — see getDebuggerPages below for why.
      const req = http.get(
        { host: '127.0.0.1', port: SERVER_PORT, path: '/api/apps' },
        res => {
          let data = ''
          res.on('data', chunk => (data += chunk))
          res.on('end', () => resolve(data))
        },
      )
      req.on('error', reject)
      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error(`The backend did not answer within 10s on port ${SERVER_PORT}.`))
      })
    })
    return JSON.parse(body)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    // Saying which half failed matters: an empty list here is otherwise
    // indistinguishable from a machine with nothing installed.
    return { success: false, error: `Could not read the application list: ${message}`, apps: [] }
  }
})

// ============ CDP LAUNCH & INJECTION ============

// Track which apps are running with debug port
const debuggableApps: Map<string, { pid: number, ready: boolean }> = new Map()

// Launch an app with remote debugging enabled
ipcMain.handle('apps:launchWithDebugger', async (_, appPath: string) => {
  const appName = path.basename(appPath, '.app')
  const executablePath = path.join(appPath, 'Contents/MacOS', appName)
  
  console.log(`[Modable] Launching ${appName} with debug port ${DEBUG_PORT}...`)
  
  try {
    // Kill any existing instance
    console.log(`[Modable] Killing existing ${appName} processes...`)
    try { 
      execSync(`pkill -x "${appName}"`, { stdio: 'pipe' }) 
    } catch {
      // App wasn't running, that's fine
    }
    
    // Wait for process to fully exit
    await sleep(2000)
    
    // Launch with remote debugging
    console.log(`[Modable] Starting ${executablePath}...`)
    const child = spawn(executablePath, [`--remote-debugging-port=${DEBUG_PORT}`], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    
    debuggableApps.set(appName, { pid: child.pid || 0, ready: false })
    
    // Give the app a moment to initialize before checking debugger
    console.log(`[Modable] Giving ${appName} time to initialize...`)
    await sleep(5000) // Longer initial wait for Slack
    
    // Wait for the debugger to become available
    console.log(`[Modable] Waiting for debugger to be ready...`)
    const ready = await waitForDebugger(60000) // 60 second timeout for slower apps
    
    if (ready) {
      debuggableApps.set(appName, { pid: child.pid || 0, ready: true })
      return { 
        success: true, 
        message: `${appName} launched with Modable! You can now inject code.` 
      }
    } else {
      return { 
        success: false, 
        error: `${appName} launched but debugger not responding. The app may not support debugging.` 
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Modable] Launch error:', message)
    return { success: false, error: message }
  }
})

// Check if debugger is available
ipcMain.handle('apps:isDebuggerReady', async () => {
  try {
    const pages = await getDebuggerPages()
    return { success: true, ready: pages.length > 0, pageCount: pages.length }
  } catch {
    return { success: true, ready: false, pageCount: 0 }
  }
})

// Get list of debuggable pages
ipcMain.handle('apps:getDebuggerPages', async () => {
  try {
    const pages = await getDebuggerPages()
    return { 
      success: true, 
      pages: pages.map((p: DebuggerPage) => ({ 
        title: p.title, 
        url: p.url, 
        type: p.type 
      }))
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message, pages: [] }
  }
})

// Injection deliberately does NOT live here. It belongs to server.js, which
// evaluates the layer and then re-reads the DOM to confirm it left marked
// elements behind. This process used to carry a second, near-identical
// injector that skipped that confirmation and answered without `verified`,
// so every successful layer looked like a miss and was needlessly rewritten.
// The renderer now calls POST /api/inject in both web and desktop mode.

// ============ HELPER FUNCTIONS ============

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface DebuggerPage {
  title: string
  url: string
  type: string
  webSocketDebuggerUrl?: string
}

function getDebuggerPages(): Promise<DebuggerPage[]> {
  return new Promise((resolve, reject) => {
    // 127.0.0.1, never localhost: that name resolves to ::1 first here, while
    // the target app's debugger listens on IPv4 only, so `localhost` comes back
    // ECONNREFUSED. server.js learned this already; this copy had not, which
    // left isDebuggerReady() permanently false and every control disabled.
    const req = http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Timeout connecting to debugger'))
    })
  })
}

async function waitForDebugger(timeoutMs: number): Promise<boolean> {
  const startTime = Date.now()
  let attemptCount = 0
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      attemptCount++
      const pages = await getDebuggerPages()
      if (pages.length > 0) {
        console.log(`[Modable] Debugger ready with ${pages.length} page(s) after ${attemptCount} attempts`)
        return true
      }
    } catch (err) {
      // Not ready yet - this is expected during startup
      if (attemptCount % 10 === 0) {
        console.log(`[Modable] Still waiting for debugger... (attempt ${attemptCount})`)
      }
    }
    // Check more frequently at first, then back off
    const waitTime = attemptCount < 10 ? 300 : 1000
    await sleep(waitTime)
  }
  
  console.log(`[Modable] Debugger timeout after ${attemptCount} attempts`)
  return false
}

// Open mods folder (kept for compatibility, but simplified)
ipcMain.handle('apps:openFolder', async (_, appPath: string) => {
  const userDataPath = app.getPath('userData')
  const appName = path.basename(appPath, '.app')
  const modsPath = path.join(userDataPath, 'mods', appName.toLowerCase().replace(/\s+/g, '-'))
  
  // Create folder if it doesn't exist
  const fs = require('fs')
  if (!fs.existsSync(modsPath)) {
    fs.mkdirSync(modsPath, { recursive: true })
  }
  
  shell.openPath(modsPath)
  return { success: true }
})
