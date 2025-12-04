import { create } from 'zustand'

export interface InstalledApp {
  name: string
  path: string
  icon: string
  realIcon?: string
  version: string
  isElectron: boolean
  hasMods?: boolean
  modCount?: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  modPreview?: {
    name: string
    description: string
    code: string
  }
}

export interface AgentAction {
  type: 'thinking' | 'generating' | 'injecting'
  description: string
  timestamp: number
}

export interface InjectionRecord {
  id: string
  timestamp: number
  appName: string
  modName: string
  description: string
  success: boolean
  code: string
}

interface AppState {
  // Apps
  installedApps: InstalledApp[]
  selectedApp: InstalledApp | null
  isScanning: boolean
  
  // Debugger state
  isAppLaunched: boolean
  isDebuggerReady: boolean
  
  // Chat
  messages: Message[]
  isAgentWorking: boolean
  currentAction: AgentAction | null
  
  // API Key
  apiKey: string | null
  
  // Injection History
  injectionHistory: InjectionRecord[]
  
  // Actions
  setInstalledApps: (apps: InstalledApp[]) => void
  setSelectedApp: (app: InstalledApp | null) => void
  setScanning: (scanning: boolean) => void
  setAppLaunched: (launched: boolean) => void
  setDebuggerReady: (ready: boolean) => void
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
  updateLastMessage: (content: string, modPreview?: Message['modPreview']) => void
  setAgentWorking: (working: boolean, action?: AgentAction | null) => void
  setApiKey: (key: string | null) => void
  clearChat: () => void
  addInjection: (injection: Omit<InjectionRecord, 'id' | 'timestamp'>) => void
  deleteInjection: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  installedApps: [],
  selectedApp: null,
  isScanning: false,
  isAppLaunched: false,
  isDebuggerReady: false,
  messages: [],
  isAgentWorking: false,
  currentAction: null,
  apiKey: localStorage.getItem('modable_api_key'),
  injectionHistory: JSON.parse(localStorage.getItem('modable_injection_history') || '[]'),
  
  // Actions
  setInstalledApps: (apps) => set({ installedApps: apps }),
  
  setSelectedApp: (app) => set({ 
    selectedApp: app,
    isAppLaunched: false,
    isDebuggerReady: false,
    messages: app ? [{
      id: crypto.randomUUID(),
      role: 'system',
      content: `Ready to mod **${app.name}**!\n\n1. Click **Launch with Modable** to start ${app.name} with injection enabled\n2. Describe a feature you want to add\n3. Click **Inject** to add it instantly\n\nTry something like:\n• "Add a floating button that shows the time"\n• "Add a dark mode toggle"\n• "Add a word counter"`,
      timestamp: Date.now(),
    }] : [],
  }),
  
  setScanning: (scanning) => set({ isScanning: scanning }),
  
  setAppLaunched: (launched) => set({ isAppLaunched: launched }),
  
  setDebuggerReady: (ready) => set({ isDebuggerReady: ready }),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }],
  })),
  
  updateLastMessage: (content, modPreview) => set((state) => {
    const messages = [...state.messages]
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant') {
      messages[messages.length - 1] = {
        ...lastMessage,
        content,
        modPreview: modPreview || lastMessage.modPreview,
      }
    }
    return { messages }
  }),
  
  setAgentWorking: (working, action = null) => set({
    isAgentWorking: working,
    currentAction: action,
  }),
  
  setApiKey: (key) => {
    if (key) {
      localStorage.setItem('modable_api_key', key)
    } else {
      localStorage.removeItem('modable_api_key')
    }
    set({ apiKey: key })
  },
  
  clearChat: () => set((state) => ({
    messages: state.selectedApp ? [{
      id: crypto.randomUUID(),
      role: 'system',
      content: `Ready to mod **${state.selectedApp.name}**! Describe a feature to add.`,
      timestamp: Date.now(),
    }] : [],
  })),
  
  addInjection: (injection) => set((state) => {
    const newInjection: InjectionRecord = {
      ...injection,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }
    const newHistory = [newInjection, ...state.injectionHistory]
    localStorage.setItem('modable_injection_history', JSON.stringify(newHistory))
    return { injectionHistory: newHistory }
  }),
  
  deleteInjection: (id) => set((state) => {
    const newHistory = state.injectionHistory.filter(inj => inj.id !== id)
    localStorage.setItem('modable_injection_history', JSON.stringify(newHistory))
    return { injectionHistory: newHistory }
  }),
}))
