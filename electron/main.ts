import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { existsSync, readFileSync } from 'fs'
import { execSync, spawn } from 'child_process'
import http from 'http'

let mainWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const DEBUG_PORT = 9222

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

  // Always load from the HTTP server for consistency
  const SERVER_URL = 'http://localhost:3456'
  
  if (VITE_DEV_SERVER_URL) {
    // In dev mode, still use Vite for hot reload
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    // In production, load from HTTP server
    mainWindow.loadURL(SERVER_URL)
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ============ APP DETECTION ============

ipcMain.handle('apps:getInstalled', async () => {
  const installed = []
  
  for (const appInfo of ELECTRON_APPS) {
    if (existsSync(appInfo.path)) {
      const electronFramework = path.join(appInfo.path, 'Contents/Frameworks/Electron Framework.framework')
      const isElectron = existsSync(electronFramework)
      
      let version = 'Unknown'
      try {
        const plistPath = path.join(appInfo.path, 'Contents/Info.plist')
        if (existsSync(plistPath)) {
          const plist = readFileSync(plistPath, 'utf-8')
          const versionMatch = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)
          if (versionMatch) version = versionMatch[1]
        }
      } catch {}
      
      // Extract real icon
      const realIcon = extractAppIcon(appInfo.path)
      
      installed.push({ ...appInfo, version, isElectron, hasMods: false, modCount: 0, realIcon })
    }
  }
  
  return { success: true, apps: installed }
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

// Inject JavaScript into the running app
ipcMain.handle('apps:injectCode', async (_, code: string, targetUrl?: string) => {
  console.log('[Modable] Injecting code...')
  
  try {
    const pages = await getDebuggerPages()
    
    // Find the best page to inject into
    let targetPage = null
    
    if (targetUrl) {
      // If a specific URL pattern is provided, use it
      targetPage = pages.find((p: DebuggerPage) => p.url && p.url.includes(targetUrl))
    }
    
    if (!targetPage) {
      // Try to find main app page (not devtools, not blank)
      targetPage = pages.find((p: DebuggerPage) => 
        p.type === 'page' && 
        p.url && 
        !p.url.startsWith('devtools://') &&
        !p.url.startsWith('chrome://') &&
        !p.url.startsWith('about:') &&
        p.webSocketDebuggerUrl
      )
    }
    
    if (!targetPage) {
      // Fall back to any page with a debugger URL
      targetPage = pages.find((p: DebuggerPage) => p.webSocketDebuggerUrl)
    }
    
    if (!targetPage) {
      return { 
        success: false, 
        error: 'No injectable page found. Make sure the app is launched with Modable.' 
      }
    }
    
    console.log(`[Modable] Injecting into: ${targetPage.title} (${targetPage.url})`)
    
    // Inject via WebSocket
    const result = await injectViaWebSocket(targetPage.webSocketDebuggerUrl, code)
    return result
    
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Modable] Injection error:', message)
    return { success: false, error: message }
  }
})

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
    const req = http.get(`http://localhost:${DEBUG_PORT}/json`, (res) => {
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

function injectViaWebSocket(wsUrl: string, code: string): Promise<{ success: boolean, error?: string, result?: unknown }> {
  return new Promise((resolve) => {
    const WebSocket = require('ws')
    const ws = new WebSocket(wsUrl)
    let resolved = false
    
    const safeResolve = (result: { success: boolean, error?: string, result?: unknown }) => {
      if (!resolved) {
        resolved = true
        try { ws.close() } catch {}
        resolve(result)
      }
    }
    
    ws.on('open', () => {
      console.log('[Modable] WebSocket connected, sending code...')
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { 
          expression: code,
          returnByValue: true
        }
      }))
    })
    
    ws.on('message', (msg: Buffer | string) => {
      try {
        const response = JSON.parse(msg.toString())
        console.log('[Modable] Response:', JSON.stringify(response).slice(0, 200))
        
        if (response.id === 1) {
          if (response.error) {
            safeResolve({ success: false, error: response.error.message })
          } else if (response.result?.exceptionDetails) {
            safeResolve({ 
              success: false, 
              error: response.result.exceptionDetails.exception?.description || 'Script error' 
            })
          } else {
            safeResolve({ 
              success: true, 
              result: response.result?.result?.value 
            })
          }
        }
      } catch (e) {
        console.error('[Modable] Parse error:', e)
      }
    })
    
    ws.on('error', (err: Error) => {
      console.error('[Modable] WebSocket error:', err.message)
      safeResolve({ success: false, error: err.message })
    })
    
    // Timeout after 10 seconds
    setTimeout(() => {
      safeResolve({ success: false, error: 'Injection timeout' })
    }, 10000)
  })
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
