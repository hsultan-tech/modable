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
  /** Which path modifies this app: evaluated into a live window over CDP, or
   *  patched on disk by Spicetify. Absent from older responses, which are all
   *  CDP — hence the cdp default everywhere this is read. */
  channel?: 'cdp' | 'spicetify'
  /** Whether that path is actually usable right now. Not the same as
   *  isElectron: Spotify is reachable while never being Electron. */
  reachable?: boolean
  /** When it is not reachable, why — phrased for this app's own channel. */
  blockedBecause?: string | null
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
    /** The CDP window this layer was written against, if it is still known. */
    targetId?: string
    /** The data-modable values this layer claims, used to verify and revert it. */
    marks?: string[]
    /** How this modification reaches the application: evaluated into a live
     *  window over CDP, or written to disk and applied by the Spicetify CLI.
     *  Absent on anything written before Spotify had its own path — those are
     *  all CDP, which is why cdp is the default everywhere this is read. */
    channel?: 'cdp' | 'spicetify'
    /** spicetify only: whether this is a stylesheet or an extension. */
    kind?: 'css' | 'js'
  }
}

export interface AgentAction {
  type: 'thinking' | 'generating' | 'injecting'
  description: string
  timestamp: number
}

/** The four stages the Surface Injection sequence moves through. */
export type InjectionStage = 'idle' | 'understand' | 'plan' | 'inject' | 'verify' | 'done' | 'fault'

export interface InjectionRun {
  stage: InjectionStage
  modName: string
  layersBefore: number
  error?: string | null
}

export interface InjectionRecord {
  id: string
  timestamp: number
  appName: string
  modName: string
  description: string
  success: boolean
  code: string
  /** Which path applied it. Absent on records from before Spotify was split
   *  off; those are CDP by definition. */
  channel?: 'cdp' | 'spicetify'
  /** spicetify only: the Modable file this record owns, so it can be reverted
   *  individually later without guessing at the name again. */
  slug?: string
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

  // The running Surface Injection sequence, if any
  injectionRun: InjectionRun | null

  // Code arriving from the model, shown in the buffer as it is written
  draftCode: string

  /** A request typed in the workspace composer, waiting for the run to pick
   *  it up. Lets the composer start a write without owning the agent. */
  pendingPrompt: string | null
  
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
  setInjectionRun: (run: InjectionRun | null) => void
  setDraftCode: (code: string) => void
  setPendingPrompt: (prompt: string | null) => void
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
  injectionRun: null,
  pendingPrompt: null,
  draftCode: '',
  
  // Actions
  setInstalledApps: (apps) => set({ installedApps: apps }),
  
  setSelectedApp: (app) => set({ 
    selectedApp: app,
    isAppLaunched: false,
    isDebuggerReady: false,
    messages: app ? [{
      id: crypto.randomUUID(),
      role: 'system',
      // Spotify is patched on disk, so "start it so the debugger can attach"
      // is advice that cannot be followed there — it has no debugger.
      content: app.channel === 'spicetify'
        ? `${app.name} is ready to rewrite.\n\nModable modifies it through Spicetify: describe the change, and it is written as a file and applied to Spotify's own bundle. Restart Spotify afterwards to see it.\n\nFor example:\n"Make the now playing bar accent green"\n"Add a top bar button that skips 30 seconds forward"\n"Add a copy track name button to the top bar"`
        : `${app.name} is ready to rewrite.\n\nStart it with Modable so the debugger can attach, describe the change you want, then write the layer.\n\nFor example:\n"Add a floating button that shows the time"\n"Add a dark mode toggle"\n"Count the words in the open document"`,
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
      content: `${state.selectedApp.name} is ready to rewrite. Describe the change you want.`,
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
  
  setInjectionRun: (run) => set({ injectionRun: run }),
  setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),

  setDraftCode: (code) => set({ draftCode: code }),

  deleteInjection: (id) => set((state) => {
    const newHistory = state.injectionHistory.filter(inj => inj.id !== id)
    localStorage.setItem('modable_injection_history', JSON.stringify(newHistory))
    return { injectionHistory: newHistory }
  }),
}))
