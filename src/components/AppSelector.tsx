import { useEffect, useState } from 'react'
import { 
  Box, Zap, ArrowRight, RefreshCw, Search
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { api } from '../api'
import { Sidebar } from './Sidebar'
import { CommandPalette, useCommandPalette, CommandAction } from './CommandPalette'
import { Kbd, KbdKey } from './ui/kbd'
import { TextAnimate } from './TextAnimate'
import { ProfileMenu, ApiKeyChangeModal } from './ProfileMenu'

export function AppSelector({ onNavigateToHistory }: { onNavigateToHistory?: () => void }) {
  const { installedApps, setInstalledApps, setSelectedApp, isScanning, setScanning, setApiKey } = useAppStore()
  const commandPalette = useCommandPalette()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const scanApps = async () => {
    setScanning(true)
    try {
      console.log('[AppSelector] Fetching apps...')
      const result = await api.getApps()
      console.log('[AppSelector] API result:', result)
      if (result.success && result.apps) {
        console.log('[AppSelector] Setting', result.apps.length, 'apps')
        setInstalledApps(result.apps)
      }
    } catch (err) { 
      console.error('[AppSelector] Error fetching apps:', err) 
    }
    finally { setScanning(false) }
  }

  useEffect(() => { 
    console.log('[AppSelector] Component mounted, scanning apps...')
    scanApps() 
  }, [])

  const moddableCount = installedApps.filter(a => a.isElectron).length
  const totalMods = installedApps.reduce((acc, app) => acc + (app.modCount || 0), 0)

  console.log('[AppSelector] Render - installedApps:', installedApps.length, 'moddable:', moddableCount)

  const handleLogout = () => {
    setApiKey(null)
  }

  const handleHome = () => {
    // Already on home/app selector, so just refresh
    scanApps()
  }

  // Filter apps based on search query
  const filteredApps = searchQuery
    ? installedApps.filter(app => 
        app.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : installedApps

  const handleCommand = (action: CommandAction) => {
    switch (action.type) {
      case 'scan-apps':
        scanApps()
        break
      case 'view-history':
        onNavigateToHistory?.()
        break
      case 'change-api-key':
        setShowApiKeyModal(true)
        break
      case 'logout':
        handleLogout()
        break
      case 'select-app':
        const app = installedApps.find(a => a.name === action.appName)
        if (app) setSelectedApp(app)
        break
    }
  }

  return (
    <div className="h-full w-full frosty flex text-white overflow-hidden">
      {/* Sidebar */}
      <Sidebar 
        onLogout={handleLogout}
        onHome={handleHome}
        onHistory={onNavigateToHistory}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Top Search Bar */}
        <div className="px-8 py-4 border-b border-white/10 drag">
          <div className="flex items-center gap-4">
            <Search size={16} className="text-neutral-400" />
            <input
              type="text"
              placeholder="Find anything"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-neutral-400 placeholder-neutral-500 border-none outline-none flex-1 text-sm no-drag"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-neutral-400 hover:text-white transition-colors no-drag"
              >
                ×
              </button>
            )}
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

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-8 py-8">
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <TextAnimate 
                  animation="blurInUp" 
                  by="word"
                  className="text-4xl font-light tracking-tight"
                  startOnView={false}
                >
                  Your Apps
                </TextAnimate>
              </div>
              <p className="text-neutral-400 text-sm">Select an app to add AI-powered features</p>
            </div>
            <button 
              onClick={scanApps} 
              disabled={isScanning} 
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-all no-drag"
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              <span className="text-sm">Refresh</span>
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-neutral-900/50 rounded-xl p-5 border border-white/10"
            >
              <div className="flex items-center gap-2 text-white/40 text-sm mb-3">
                <Box className="w-4 h-4" />
                <span>Installed Apps</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-light text-white">{installedApps.length}</span>
                <span className="text-white/40 text-sm">{moddableCount} moddable</span>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-neutral-900/50 rounded-xl p-5 border border-white/10"
            >
              <div className="flex items-center gap-2 text-white/40 text-sm mb-3">
                <Zap className="w-4 h-4" />
                <span>Active Mods</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-light text-white">{totalMods}</span>
                <span className="text-white/40 text-sm">running</span>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-neutral-900/50 rounded-xl p-5 border border-white/10"
            >
              <div className="flex items-center gap-2 text-white/40 text-sm mb-3">
                <Box className="w-4 h-4" />
                <span>Status</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-light text-white">Ready</span>
                <span className="text-white/40 text-sm">No issues</span>
              </div>
            </motion.div>
          </div>

          {/* Apps grid */}
          <div className="grid grid-cols-2 gap-4">
            {filteredApps.map((app, index) => (
              <motion.button
                key={app.path}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + index * 0.05 }}
                onClick={() => setSelectedApp(app)}
                className="group text-left rounded-xl border border-white/10 hover:border-white/20 transition-all duration-300 overflow-hidden card-hover no-drag"
              >
                {/* Inner dark card with dot pattern */}
                <div className="relative h-36 bg-neutral-950 m-3 rounded-lg overflow-hidden">
                  {/* Dot pattern background */}
                  <div 
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
                      backgroundSize: '20px 20px'
                    }}
                  />
                  
                  {/* Centered icon */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                      {/* Outer ring on hover */}
                      <div className="absolute inset-0 w-20 h-20 -translate-x-2 -translate-y-2 rounded-2xl border border-white/0 group-hover:border-white/10 transition-all duration-300" />
                      
                      {/* Icon container */}
                      <div className="relative w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/20 transition-all duration-300 backdrop-blur-sm overflow-hidden">
                        {app.realIcon ? (
                          <img 
                            src={app.realIcon} 
                            alt={app.name}
                            className="w-12 h-12 object-contain filter grayscale opacity-90 group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-300"
                          />
                        ) : (
                          <span className="text-3xl filter grayscale opacity-90 group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-300">
                            {app.icon}
                          </span>
                        )}
                      </div>
                      
                      {/* Subtle glow effect on hover */}
                      <div className="absolute inset-0 w-16 h-16 rounded-xl bg-white/5 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </div>
                  </div>

                  {/* Moddable badge */}
                  {app.isElectron && (
                    <div className="absolute top-3 right-3 w-6 h-6 rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                      <Zap className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 pb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-white font-medium text-base">{app.name}</h3>
                    <p className="text-white/40 text-sm">v{app.version}</p>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white group-hover:border-white transition-all">
                    <ArrowRight className="w-4 h-4 text-white/40 group-hover:text-black transition-colors" />
                  </div>
                </div>
              </motion.button>
            ))}
          </div>

          {filteredApps.length === 0 && searchQuery && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <Search className="w-16 h-16 mx-auto mb-4 text-white/20" />
              <p className="text-white/40 text-lg">No apps found</p>
              <p className="text-white/20 text-sm mt-2">Try a different search term</p>
            </motion.div>
          )}

          {installedApps.length === 0 && !isScanning && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <Box className="w-16 h-16 mx-auto mb-4 text-white/20" />
              <p className="text-white/40 text-lg">No apps found</p>
              <p className="text-white/20 text-sm mt-2">Install Slack, Discord, or VS Code</p>
            </motion.div>
          )}
        </div>
      </main>

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
