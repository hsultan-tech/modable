import { useState, useEffect } from 'react'
import { 
  ArrowLeft, Send, Bot, Loader2, Zap, 
  MessageSquare, Play, CheckCircle, XCircle, Syringe,
  Search, Plus, MessageCircle, ArrowUp
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { useModAgent } from '../agent/useModAgent'
import { api } from '../api'
import { Sidebar } from './Sidebar'
import { CommandPalette, useCommandPalette, CommandAction } from './CommandPalette'
import { Kbd, KbdKey } from './ui/kbd'
import { ProfileMenu, ApiKeyChangeModal } from './ProfileMenu'

export function ModWorkspace({ onNavigateToHistory }: { onNavigateToHistory?: () => void }) {
  const { 
    selectedApp, setSelectedApp, messages, isAgentWorking, currentAction,
    isAppLaunched, setAppLaunched, isDebuggerReady, setDebuggerReady, setApiKey
  } = useAppStore()
  const { generateMod } = useModAgent()
  const [input, setInput] = useState('')
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const commandPalette = useCommandPalette()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  // Auto-detect if debugger is already running (check every 1 second for faster detection)
  useEffect(() => {
    const checkDebugger = async () => {
      try {
        const status = await api.isDebuggerReady()
        if (status.ready && status.pageCount > 0) {
          setAppLaunched(true)
          setDebuggerReady(true)
          setLaunchError(null) // Clear any previous errors when debugger is ready
        }
      } catch {
        // Debugger not available
      }
    }
    checkDebugger()
    const interval = setInterval(checkDebugger, 1000) // Check every second for faster detection
    return () => clearInterval(interval)
  }, [setAppLaunched, setDebuggerReady])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isAgentWorking || !selectedApp) return
    const msg = input.trim()
    setInput('')
    await generateMod(msg)
  }

  const handleLaunch = async () => {
    if (!selectedApp) return
    setIsLaunching(true)
    setLaunchError(null)
    
    try {
      const result = await api.launchWithDebugger(selectedApp.path)
      if (result.success) {
        setAppLaunched(true)
        setDebuggerReady(true)
        setLaunchError(null)
      } else {
        // Don't treat as fatal error - app might still be initializing
        console.log('[ModWorkspace] Launch warning:', result.error)
        setLaunchError(result.error || 'Failed to launch')
        // Keep checking in background - might connect later
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Failed to launch')
    } finally {
      setIsLaunching(false)
    }
  }

  const handleRefreshStatus = async () => {
    try {
      const status = await api.isDebuggerReady()
      if (status.ready && status.pageCount > 0) {
        setAppLaunched(true)
        setDebuggerReady(true)
        setLaunchError(null)
      }
    } catch (err) {
      console.error('Failed to check debugger status:', err)
    }
  }

  const handleLogout = () => {
    setApiKey(null)
  }

  const handleHome = () => {
    // Go back to app selector
    setSelectedApp(null)
  }

  const handleCommand = (action: CommandAction) => {
    switch (action.type) {
      case 'view-history':
        onNavigateToHistory?.()
        break
      case 'change-api-key':
        setShowApiKeyModal(true)
        break
      case 'logout':
        handleLogout()
        break
    }
  }

  if (!selectedApp) return null

  return (
    <div className="h-full w-full frosty flex text-white overflow-hidden">
      {/* Sidebar */}
      <Sidebar 
        onNavigate={(view) => {
          if (view === 'home' || view === 'apps') {
            setSelectedApp(null)
          }
        }}
        onLogout={handleLogout}
        onHome={handleHome}
        onHistory={onNavigateToHistory}
      />

      {/* Left Panel - App Info */}
      <div className="w-80 bg-neutral-900/30 border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <button 
            onClick={() => setSelectedApp(null)} 
            className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-6 transition-colors no-drag"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to apps
          </button>
          
          {/* App card */}
          <div className="relative h-28 bg-neutral-950 rounded-xl overflow-hidden mb-4">
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
                backgroundSize: '16px 16px'
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-sm overflow-hidden">
                {selectedApp.realIcon ? (
                  <img 
                    src={selectedApp.realIcon} 
                    alt={selectedApp.name}
                    className="w-10 h-10 object-contain filter grayscale"
                  />
                ) : (
                  <span className="text-2xl">{selectedApp.icon}</span>
                )}
              </div>
            </div>
          </div>
          
          <h2 className="text-lg font-medium text-white">{selectedApp.name}</h2>
          <p className="text-white/40 text-sm">v{selectedApp.version}</p>
        </div>

        {/* Launch Section */}
        <div className="p-4 border-b border-white/10 space-y-3">
          {!isAppLaunched ? (
            <button 
              onClick={handleLaunch} 
              disabled={isLaunching}
              className="w-full py-3.5 rounded-lg bg-white text-black font-medium flex items-center justify-center gap-3 transition-all disabled:opacity-50 hover:bg-white/90 no-drag"
            >
              {isLaunching ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Launch with Modable
                </>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="py-3.5 rounded-lg bg-white/5 border border-white/10 text-white/80 font-medium flex items-center justify-center gap-3">
                <CheckCircle className="w-5 h-5" />
                Ready for Injection
              </div>
              
              <button 
                onClick={handleLaunch}
                disabled={isLaunching}
                className="w-full py-3 rounded-lg bg-neutral-900/50 border border-white/10 text-white/50 hover:text-white hover:border-white/20 text-sm font-medium flex items-center justify-center gap-2 transition-all no-drag"
              >
                {isLaunching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Relaunch
              </button>
            </div>
          )}

          {launchError && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-3 px-4 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs"
            >
              <div className="flex items-start gap-2 mb-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{launchError}</span>
              </div>
              <button
                onClick={handleRefreshStatus}
                className="w-full mt-2 py-1.5 px-3 rounded bg-white/10 hover:bg-white/20 transition-colors text-xs font-medium"
              >
                Check Connection Again
              </button>
            </motion.div>
          )}
        </div>

        {/* Status */}
        <div className="flex-1 p-4">
          <div className="flex items-center gap-2 text-white/40 mb-4">
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">Status</span>
          </div>

          <div className="space-y-2">
            <StatusItem 
              label="App Connected" 
              status={isAppLaunched ? 'success' : 'pending'} 
            />
            <StatusItem 
              label="Debugger Ready" 
              status={isDebuggerReady ? 'success' : 'pending'} 
            />
          </div>

          <div className="mt-6 p-4 rounded-lg bg-neutral-900/50 border border-white/10">
            <h4 className="text-white/80 text-sm font-medium mb-2">How it works</h4>
            <ol className="text-white/40 text-xs space-y-1.5">
              <li>1. Launch the app with Modable</li>
              <li>2. Describe what you want to add</li>
              <li>3. Click Inject to add it live</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="px-6 py-4 border-b border-white/10 drag">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-black" />
              </div>
              <div>
                <h3 className="font-medium text-white">AI Feature Builder</h3>
                <p className="text-white/40 text-xs">Describe what you want to add</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Kbd className="no-drag cursor-pointer" onClick={commandPalette.open}>
                <KbdKey>⌘</KbdKey>
                <KbdKey>K</KbdKey>
              </Kbd>
              <ProfileMenu
                onChangeApiKey={() => setShowApiKeyModal(true)}
                onViewHistory={onNavigateToHistory}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div 
                key={msg.id} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                {msg.role === 'system' ? (
                  <div className="bg-neutral-900/50 rounded-xl p-5 border border-white/10 max-w-2xl">
                    <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content.replace(/\*\*/g, '')}
                    </p>
                  </div>
                ) : msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-white rounded-xl rounded-br-sm px-5 py-4 max-w-md">
                      <p className="text-black text-sm font-medium">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 max-w-2xl">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-neutral-900 border border-white/10 flex items-center justify-center shrink-0">
                        <Bot className="w-5 h-5 text-white/60" />
                      </div>
                      <div className="bg-neutral-900/50 rounded-xl rounded-tl-sm p-5 border border-white/10 flex-1">
                        <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content.replace(/\*\*/g, '')}
                        </p>
                      </div>
                    </div>
                    {msg.modPreview && (
                      <CodePreview 
                        mod={msg.modPreview} 
                        canInject={isDebuggerReady}
                      />
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isAgentWorking && currentAction && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-4 bg-neutral-900/50 rounded-xl p-5 border border-white/20 max-w-2xl"
            >
              <Zap className="w-5 h-5 text-white" />
              <span className="text-white/80 text-sm">{currentAction.description}</span>
              <Loader2 className="w-5 h-5 text-white animate-spin ml-auto" />
            </motion.div>
          )}
        </div>

        {/* Bottom Chat Input */}
        <div className="px-6 py-4 border-t border-white/10">
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-4">
              <div className="flex-1 flex items-center gap-3 bg-neutral-900/50 px-4 py-3 rounded-lg border border-white/10">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isAppLaunched ? "Describe a feature to add..." : "Launch the app first..."}
                  disabled={isAgentWorking || !isAppLaunched}
                  className="bg-transparent text-white placeholder-neutral-500 border-none outline-none flex-1 no-drag disabled:opacity-50"
                />
                <button type="button" className="text-neutral-400 hover:text-white no-drag transition-colors">
                  <Plus size={16} />
                </button>
                <button type="button" className="text-neutral-400 hover:text-white no-drag transition-colors">
                  <MessageCircle size={16} />
                </button>
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isAgentWorking || !isAppLaunched}
                className="w-10 h-10 bg-white text-black rounded-lg flex items-center justify-center hover:bg-white/90 no-drag transition-colors disabled:opacity-50 disabled:bg-white/10 disabled:text-white/30"
              >
                {isAgentWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette 
        isOpen={commandPalette.isOpen} 
        onClose={commandPalette.close}
        onCommand={handleCommand}
      />

      {/* API Key Change Modal */}
      <ApiKeyChangeModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </div>
  )
}

function StatusItem({ label, status }: { label: string; status: 'pending' | 'success' | 'error' }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-neutral-900/50 border border-white/10">
      <span className="text-white/60 text-sm">{label}</span>
      {status === 'success' ? (
        <CheckCircle className="w-4 h-4 text-white" />
      ) : status === 'error' ? (
        <XCircle className="w-4 h-4 text-red-400" />
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-white/20" />
      )}
    </div>
  )
}

function CodePreview({ mod, canInject }: { 
  mod: { name: string; description: string; code: string }
  canInject: boolean 
}) {
  const [isInjecting, setIsInjecting] = useState(false)
  const [injected, setInjected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { selectedApp, addInjection } = useAppStore()

  const handleInject = async () => {
    setIsInjecting(true)
    setError(null)
    
    try {
      const result = await api.injectCode(mod.code)
      if (result.success) {
        setInjected(true)
        
        // Record successful injection
        if (selectedApp) {
          addInjection({
            appName: selectedApp.name,
            modName: mod.name,
            description: mod.description,
            success: true,
            code: mod.code,
          })
        }
      } else {
        setError(result.error || 'Injection failed')
        
        // Record failed injection
        if (selectedApp) {
          addInjection({
            appName: selectedApp.name,
            modName: mod.name,
            description: mod.description,
            success: false,
            code: mod.code,
          })
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Injection failed'
      setError(errorMessage)
      
      // Record failed injection
      if (selectedApp) {
        addInjection({
          appName: selectedApp.name,
          modName: mod.name,
          description: mod.description,
          success: false,
          code: mod.code,
        })
      }
    } finally {
      setIsInjecting(false)
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-13 bg-neutral-900/50 rounded-xl p-5 border border-white/20"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-white font-medium">{mod.name}</h4>
          <p className="text-white/40 text-sm">{mod.description}</p>
        </div>
        
        {injected ? (
          <span className="text-white text-sm font-medium flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Injected!
          </span>
        ) : (
          <button 
            onClick={handleInject} 
            disabled={isInjecting || !canInject}
            className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 hover:bg-white/90 no-drag"
          >
            {isInjecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Syringe className="w-4 h-4" />
            )}
            {isInjecting ? 'Injecting...' : 'Inject'}
          </button>
        )}
      </div>
      
      {error && (
        <div className="mb-3 py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}
      
      <pre className="bg-neutral-950 rounded-lg p-4 text-xs text-white/40 font-mono overflow-x-auto border border-white/10 max-h-32">
        {mod.code.slice(0, 400)}{mod.code.length > 400 ? '...' : ''}
      </pre>
    </motion.div>
  )
}
