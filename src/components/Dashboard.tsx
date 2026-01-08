import { useEffect, useState } from 'react'
import { 
  Zap, ArrowRight, RefreshCw, Box, 
  Activity, Clock, ChevronRight, Settings, Cpu
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { api } from '../api'
import { DashboardSidebar } from './DashboardSidebar'
import { CommandPalette, useCommandPalette, CommandAction } from './CommandPalette'
import { ApiKeyChangeModal } from './ProfileMenu'

export function Dashboard({ onNavigateToHistory }: { onNavigateToHistory?: () => void }) {
  const { installedApps, setInstalledApps, setSelectedApp, isScanning, setScanning, setApiKey, injectionHistory } = useAppStore()
  const commandPalette = useCommandPalette()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  const scanApps = async () => {
    setScanning(true)
    try {
      const result = await api.getApps()
      if (result.success && result.apps) {
        setInstalledApps(result.apps)
      }
    } catch (err) { 
      console.error('[Dashboard] Error fetching apps:', err) 
    }
    finally { setScanning(false) }
  }

  useEffect(() => { 
    scanApps() 
    // Update time every minute
    const interval = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  const moddableCount = installedApps.filter(a => a.isElectron).length
  const totalMods = installedApps.reduce((acc, app) => acc + (app.modCount || 0), 0)
  const recentInjections = injectionHistory?.slice(0, 5) || []

  const handleLogout = () => setApiKey(null)

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

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    }).toUpperCase()
  }

  return (
    <div className="h-full w-full flex bg-[#0a0a0f] text-white overflow-hidden">
      {/* Sidebar */}
      <DashboardSidebar 
        onLogout={handleLogout}
        onRefresh={scanApps}
        onHistory={onNavigateToHistory}
        onOpenCommandPalette={commandPalette.open}
        onSettings={() => setShowApiKeyModal(true)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Dashboard Content */}
        <div className="flex-1 overflow-hidden p-8">
          {/* Widget Grid */}
          <div className="grid grid-cols-12 gap-6 h-full grid-rows-2">
            
            {/* Featured Apps Grid */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="col-span-6 row-span-2 overflow-hidden"
            >
              <div className="h-full rounded-2xl bg-gradient-to-br from-[#0f1115] via-[#0f1115] to-[#0a0a0f] border border-white/10 shadow-xl shadow-black/20 p-6 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Your Applications</h3>
                    <p className="text-white/40 text-sm">{moddableCount} ready to modify</p>
                  </div>
                  <button 
                    onClick={scanApps}
                    disabled={isScanning}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <RefreshCw size={16} className={`text-white/60 ${isScanning ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Apps Grid */}
                <div className="grid grid-cols-2 gap-3 flex-1 overflow-y-auto overflow-x-hidden">
                  {installedApps.slice(0, 6).map((app, index) => (
                    <motion.button
                      key={app.path}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.15 + index * 0.05 }}
                      onClick={() => setSelectedApp(app)}
                      className="group p-4 rounded-xl bg-gradient-to-br from-[#0a0a0f] to-[#0f1115] border border-white/10 hover:border-blue-500/50 hover:bg-gradient-to-br hover:from-blue-600/10 hover:to-purple-600/10 transition-all flex flex-col items-center gap-3 hover:shadow-lg hover:shadow-blue-500/10"
                    >
                      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden group-hover:border-blue-500/30 transition-colors">
                        {app.realIcon ? (
                          <img 
                            src={app.realIcon} 
                            alt={app.name}
                            className="w-8 h-8 object-contain"
                          />
                        ) : (
                          <span className="text-2xl">{app.icon}</span>
                        )}
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <p className="text-sm font-medium text-white truncate">{app.name}</p>
                          {app.isElectron && (
                            <Zap size={10} className="text-blue-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-white/40">v{app.version}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>

                {installedApps.length > 6 && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-center text-sm text-white/40">
                      +{installedApps.length - 6} more apps available
                    </p>
                  </div>
                )}

                {installedApps.length === 0 && !isScanning && (
                  <div className="flex-1 flex flex-col items-center justify-center py-12">
                    <Box size={48} className="mb-4 text-white/10" />
                    <p className="text-white/40 text-sm mb-1">No apps detected</p>
                    <p className="text-white/20 text-xs">Click refresh to scan</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Apps Overview Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="col-span-3 row-span-1 overflow-hidden"
            >
              <div className="h-full rounded-2xl bg-gradient-to-br from-blue-600/10 via-[#0f1115] to-[#0a0a0f] border border-blue-500/20 shadow-xl shadow-blue-500/5 p-6 relative overflow-hidden">
                {/* Background glow effect */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-white/80 font-medium">Apps Overview</h3>
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                      <Box size={18} className="text-blue-400" />
                    </div>
                  </div>
                  
                  <div className="text-5xl font-bold text-white mb-2 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
                    {installedApps.length}
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-6">
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <Activity size={14} />
                      {moddableCount} moddable
                    </span>
                  </div>

                  {/* Mini bar chart */}
                  <div className="mt-6 flex items-end gap-1.5 h-20">
                    {[40, 65, 45, 80, 55, 70, 90, 60].map((h, i) => (
                      <div 
                        key={i}
                        className="flex-1 bg-gradient-to-t from-blue-600/30 to-blue-400/60 rounded-t hover:from-blue-500/40 hover:to-blue-300/70 transition-all cursor-pointer"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Active Mods Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="col-span-3 row-span-1 overflow-hidden"
            >
              <div className="h-full rounded-2xl bg-gradient-to-br from-purple-600/10 via-[#0f1115] to-[#0a0a0f] border border-purple-500/20 shadow-xl shadow-purple-500/5 p-6 relative overflow-hidden">
                {/* Background glow effect */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-white/80 font-medium">Active Mods</h3>
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                      <Zap size={18} className="text-purple-400" />
                    </div>
                  </div>
                  
                  <div className="text-5xl font-bold text-white mb-2 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
                    {totalMods}
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-6">
                    <span className="text-purple-400 flex items-center gap-1 font-medium">
                      <Zap size={14} />
                      Running
                    </span>
                  </div>

                  {/* Circular progress */}
                  <div className="relative w-28 h-28 mx-auto">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle 
                        cx="56" cy="56" r="48" 
                        stroke="rgba(168,85,247,0.1)" 
                        strokeWidth="10" 
                        fill="none" 
                      />
                      <circle 
                        cx="56" cy="56" r="48" 
                        stroke="url(#gradient-purple)" 
                        strokeWidth="10" 
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(totalMods / Math.max(installedApps.length, 1)) * 301} 301`}
                      />
                      <defs>
                        <linearGradient id="gradient-purple" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#A855F7" />
                          <stop offset="100%" stopColor="#C084FC" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold text-white">
                        {Math.round((totalMods / Math.max(installedApps.length, 1)) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Recent Activity Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="col-span-6 row-span-1 overflow-hidden"
            >
              <div className="h-full rounded-2xl bg-gradient-to-br from-[#0f1115] via-[#0f1115] to-[#0a0a0f] border border-white/10 shadow-xl shadow-black/20 p-6 relative overflow-hidden">
                {/* Background glow effect */}
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-white font-semibold text-lg mb-1">Recent Injections</h3>
                      <p className="text-white/40 text-sm">Latest modifications</p>
                    </div>
                    <button 
                      onClick={onNavigateToHistory}
                      className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 flex items-center gap-2 hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                      View All
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {recentInjections.length > 0 ? (
                      recentInjections.slice(0, 3).map((injection, i) => (
                        <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
                          <div className={`w-10 h-10 rounded-lg ${injection.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'} flex items-center justify-center`}>
                            <Zap size={18} className={injection.success ? 'text-emerald-400' : 'text-red-400'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{injection.modName}</p>
                            <p className="text-xs text-white/40">{injection.appName}</p>
                          </div>
                          <span className={`text-xs font-medium px-3 py-1 rounded-full ${injection.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                            {injection.success ? 'Success' : 'Failed'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="py-12 text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                          <Cpu size={32} className="text-white/20" />
                        </div>
                        <p className="text-white/60 font-medium mb-1">No injections yet</p>
                        <p className="text-white/30 text-sm">Select an app to get started</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
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



