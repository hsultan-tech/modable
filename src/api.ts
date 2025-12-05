// API client for Modable - works in both Electron and web modes

const API_BASE = '/api';

export interface App {
  name: string;
  path: string;
  icon: string;
  version: string;
  isElectron: boolean;
  hasMods?: boolean;
  modCount?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electron !== undefined;

console.log('[API] Environment check - isElectron:', isElectron, 'window.electron:', typeof window !== 'undefined' ? window.electron : 'N/A');

export const api = {
  async getApps(): Promise<{ success: boolean; apps: App[] }> {
    console.log('[API] getApps() called, isElectron:', isElectron);
    if (isElectron) {
      // Use Electron IPC
      console.log('[API] Using Electron IPC');
      const result = await window.electron.getInstalledApps();
      return { success: result.success, apps: result.apps || [] };
    } else {
      // Use HTTP API
      console.log('[API] Using HTTP fetch to', `${API_BASE}/apps`);
      const res = await fetch(`${API_BASE}/apps`);
      const data = await res.json();
      console.log('[API] HTTP response:', data);
      return data;
    }
  },

  async launchWithDebugger(appPath: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (isElectron) {
      // Use Electron IPC
      return await window.electron.launchWithDebugger(appPath);
    } else {
      // Use HTTP API
      const res = await fetch(`${API_BASE}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appPath }),
      });
      return res.json();
    }
  },

  async isDebuggerReady(): Promise<{ success: boolean; ready: boolean; pageCount: number }> {
    if (isElectron) {
      // Use Electron IPC
      return await window.electron.isDebuggerReady();
    } else {
      // Use HTTP API
      const res = await fetch(`${API_BASE}/debugger/status`);
      return res.json();
    }
  },

  async injectCode(code: string, targetUrl?: string): Promise<{ success: boolean; error?: string; result?: unknown }> {
    if (isElectron) {
      // Use Electron IPC
      return await window.electron.injectCode(code, targetUrl);
    } else {
      // Use HTTP API
      const res = await fetch(`${API_BASE}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, targetUrl }),
      });
      return res.json();
    }
  },
};

