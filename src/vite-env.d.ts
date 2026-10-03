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
    // No injectCode here on purpose. Injection goes over HTTP so the caller
    // gets `verified` back; this declaration previously typed an IPC reply
    // without it, which is why the missing field never failed the build.

    // Utility
    openAppFolder: (appPath: string) => Promise<{ success: boolean; error?: string }>
  }
}
