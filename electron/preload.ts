import { contextBridge, ipcRenderer } from 'electron'

export interface InstalledApp {
  name: string
  path: string
  icon: string
  realIcon?: string
  version: string
  isElectron: boolean
  hasMods: boolean
  modCount: number
}

// Response types for IPC calls
interface BaseResponse {
  success: boolean
  error?: string
  message?: string
}

interface AppsResponse extends BaseResponse {
  apps?: InstalledApp[]
}

interface DebuggerReadyResponse extends BaseResponse {
  ready: boolean
  pageCount: number
}

interface DebuggerPagesResponse extends BaseResponse {
  pages: { title: string; url: string; type: string }[]
}

const electronAPI = {
  // App detection
  getInstalledApps: (): Promise<AppsResponse> => ipcRenderer.invoke('apps:getInstalled'),
  
  // CDP Launch & Injection (new simplified API)
  launchWithDebugger: (appPath: string): Promise<BaseResponse> => 
    ipcRenderer.invoke('apps:launchWithDebugger', appPath),
  
  isDebuggerReady: (): Promise<DebuggerReadyResponse> => 
    ipcRenderer.invoke('apps:isDebuggerReady'),
  
  getDebuggerPages: (): Promise<DebuggerPagesResponse> => 
    ipcRenderer.invoke('apps:getDebuggerPages'),
  
  // Injection is not bridged. It goes to POST /api/inject, which verifies the
  // layer actually landed before answering — see electron/main.ts.

  // Utility
  openAppFolder: (appPath: string): Promise<BaseResponse> => 
    ipcRenderer.invoke('apps:openFolder', appPath),
}

contextBridge.exposeInMainWorld('electron', electronAPI)

declare global {
  interface Window {
    electron: typeof electronAPI
  }
}
