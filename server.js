const express = require('express');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const PORT = 3456;
const DEBUG_PORT = 9222;

app.use(express.json());
app.use(express.static('dist'));

// Known Electron apps
const KNOWN_APPS = [
  { name: 'Slack', path: '/Applications/Slack.app', icon: '💬' },
  { name: 'Discord', path: '/Applications/Discord.app', icon: '🎮' },
  { name: 'VS Code', path: '/Applications/Visual Studio Code.app', icon: '💻' },
  { name: 'Notion', path: '/Applications/Notion.app', icon: '📝' },
  { name: 'Figma', path: '/Applications/Figma.app', icon: '🎨' },
  { name: 'Spotify', path: '/Applications/Spotify.app', icon: '🎵' },
  { name: 'WhatsApp', path: '/Applications/WhatsApp.app', icon: '📱' },
  { name: 'Telegram', path: '/Applications/Telegram.app', icon: '✈️' },
  { name: 'Obsidian', path: '/Applications/Obsidian.app', icon: '🗃️' },
];

// Helper to extract app icon as base64
function extractAppIcon(appPath) {
  try {
    const iconPath = path.join(appPath, 'Contents/Resources');
    if (!fs.existsSync(iconPath)) return null;
    
    const icnsFiles = fs.readdirSync(iconPath).filter(f => f.endsWith('.icns'));
    if (icnsFiles.length === 0) return null;
    
    const icnsFile = path.join(iconPath, icnsFiles[0]);
    const tempPng = path.join('/tmp', `${path.basename(appPath, '.app')}-${Date.now()}.png`);
    
    // Convert .icns to PNG using sips (built-in macOS tool)
    execSync(`sips -s format png "${icnsFile}" --out "${tempPng}" -Z 128 2>/dev/null`, { stdio: 'pipe' });
    
    if (fs.existsSync(tempPng)) {
      const imageBuffer = fs.readFileSync(tempPng);
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      
      // Clean up temp file
      try { fs.unlinkSync(tempPng); } catch {}
      
      return base64Image;
    }
  } catch (err) {
    console.error(`Failed to extract icon for ${path.basename(appPath)}:`, err.message);
  }
  return null;
}

// Get installed apps
app.get('/api/apps', (req, res) => {
  const apps = [];
  for (const appInfo of KNOWN_APPS) {
    if (fs.existsSync(appInfo.path)) {
      const electronFramework = path.join(appInfo.path, 'Contents/Frameworks/Electron Framework.framework');
      const isElectron = fs.existsSync(electronFramework);
      
      let version = 'Unknown';
      try {
        const plistPath = path.join(appInfo.path, 'Contents/Info.plist');
        if (fs.existsSync(plistPath)) {
          const content = fs.readFileSync(plistPath, 'utf-8');
          const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
          if (match) version = match[1];
        }
      } catch {}
      
      // Extract real icon
      const realIcon = extractAppIcon(appInfo.path);
      
      apps.push({ ...appInfo, version, isElectron, hasMods: false, modCount: 0, realIcon });
    }
  }
  res.json({ success: true, apps });
});

// Launch app with debugger
app.post('/api/launch', async (req, res) => {
  const { appPath } = req.body;
  const appName = path.basename(appPath, '.app');
  const executable = path.join(appPath, 'Contents/MacOS', appName);
  
  console.log(`[Modable] Launching ${appName} with debug port ${DEBUG_PORT}...`);
  
  try {
    // First check if debugger is already available
    try {
      const pages = await getDebuggerPages();
      if (pages.length > 0) {
        console.log(`[Modable] ${appName} already running with debugger!`);
        return res.json({ success: true, message: `${appName} already connected!` });
      }
    } catch {
      // Debugger not available, proceed with launch
    }
    
    // Kill existing
    console.log(`[Modable] Killing existing ${appName}...`);
    try {
      execSync(`pkill -x "${appName}"`, { stdio: 'pipe' });
    } catch {}
    
    await sleep(2000);
    
    // Launch with debug port
    console.log(`[Modable] Starting ${appName} with debugger...`);
    const child = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    
    // Wait for debugger
    const ready = await waitForDebugger(15000);
    if (ready) {
      res.json({ success: true, message: `${appName} launched with Modable!` });
    } else {
      // Still return success but with warning - auto-detect will pick it up later
      res.json({ success: true, message: `${appName} launched - connecting...` });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Check debugger status
app.get('/api/debugger/status', async (req, res) => {
  try {
    const pages = await getDebuggerPages();
    res.json({ success: true, ready: pages.length > 0, pageCount: pages.length });
  } catch {
    res.json({ success: true, ready: false, pageCount: 0 });
  }
});

// Inject code
app.post('/api/inject', async (req, res) => {
  const { code, targetUrl } = req.body;
  console.log('[Modable] Injecting code...');
  
  try {
    const pages = await getDebuggerPages();
    
    // Find best page
    let target = null;
    if (targetUrl) {
      target = pages.find(p => p.url && p.url.includes(targetUrl));
    }
    if (!target) {
      target = pages.find(p => 
        p.type === 'page' && 
        p.url && 
        !p.url.startsWith('devtools://') && 
        !p.url.startsWith('chrome://') &&
        !p.url.startsWith('about:') &&
        p.webSocketDebuggerUrl
      );
    }
    if (!target) {
      target = pages.find(p => p.webSocketDebuggerUrl);
    }
    
    if (!target) {
      return res.json({ success: false, error: 'No injectable page found' });
    }
    
    console.log(`[Modable] Injecting into: ${target.title} (${target.url})`);
    const result = await injectViaWebSocket(target.webSocketDebuggerUrl, code);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Helper functions
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getDebuggerPages() {
  return new Promise((resolve, reject) => {
    // Use 127.0.0.1 instead of localhost to avoid IPv6 issues
    const req = http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function waitForDebugger(timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const pages = await getDebuggerPages();
      if (pages.length > 0) {
        console.log(`[Modable] Debugger ready with ${pages.length} page(s)`);
        return true;
      }
    } catch {}
    await sleep(500);
  }
  return false;
}

function injectViaWebSocket(wsUrl, code) {
  return new Promise(resolve => {
    // Replace localhost with 127.0.0.1 to avoid IPv6 issues
    const fixedWsUrl = wsUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(fixedWsUrl);
    let done = false;
    
    const finish = result => {
      if (!done) {
        done = true;
        try { ws.close(); } catch {}
        resolve(result);
      }
    };
    
    ws.on('open', () => {
      console.log('[Modable] WebSocket connected');
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: code, returnByValue: true }
      }));
    });
    
    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === 1) {
          if (msg.error) {
            finish({ success: false, error: msg.error.message });
          } else if (msg.result?.exceptionDetails) {
            finish({ success: false, error: msg.result.exceptionDetails.exception?.description || 'Script error' });
          } else {
            finish({ success: true, result: msg.result?.result?.value });
          }
        }
      } catch {}
    });
    
    ws.on('error', err => finish({ success: false, error: err.message }));
    setTimeout(() => finish({ success: false, error: 'Timeout' }), 10000);
  });
}

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                   MODABLE                      ║
║      AI-Powered Desktop App Modifier          ║
╠═══════════════════════════════════════════════╣
║  Open in your browser:                        ║
║  → http://localhost:${PORT}                       ║
╚═══════════════════════════════════════════════╝
  `);
});

