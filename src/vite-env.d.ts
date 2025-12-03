/// <reference types="vite/client" />

interface InstalledApp {
  name: string
  path: string
  icon: string
  version: string
  isElectron: boolean
  hasMods?: boolean
  modCount?: number
}

interface Window {
  electron: {
    // App detection
    getInstalledApps: () => Promise<{ success: boolean; apps?: InstalledApp[]; error?: string }>
    
    // CDP Launch & Injection
    launchWithDebugger: (appPath: string) => Promise<{ success: boolean; message?: string; error?: string }>
    isDebuggerReady: () => Promise<{ success: boolean; ready: boolean; pageCount: number }>
    getDebuggerPages: () => Promise<{ success: boolean; pages: { title: string; url: string; type: string }[]; error?: string }>
    injectCode: (code: string, targetUrl?: string) => Promise<{ success: boolean; result?: unknown; error?: string }>
    
    // Utility
    openAppFolder: (appPath: string) => Promise<{ success: boolean; error?: string }>
  }
}
