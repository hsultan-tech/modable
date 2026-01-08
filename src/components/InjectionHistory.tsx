import { useState } from 'react'
import { motion } from 'framer-motion'
import { History, ArrowLeft, CheckCircle, XCircle, Clock, Code, Trash2 } from 'lucide-react'
import { DashboardSidebar } from './DashboardSidebar'
import { ApiKeyChangeModal } from './ProfileMenu'
import { useAppStore } from '../stores/projectStore'

interface InjectionHistoryProps {
  onBack?: () => void
}

export function InjectionHistory({ onBack }: InjectionHistoryProps) {
  const { setApiKey, injectionHistory, deleteInjection } = useAppStore()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  const handleLogout = () => {
    setApiKey(null)
  }

  const handleHome = () => {
    onBack?.()
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = Date.now()
    const diff = now - timestamp
    
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} minutes ago`
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} hours ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  return (
    <div className="h-full w-full flex bg-[#0a0a0f] text-white overflow-hidden">
      <DashboardSidebar 
        onLogout={handleLogout}
        onRefresh={handleHome}
        onHistory={() => {}}
        onSettings={() => setShowApiKeyModal(true)}
        activeView="history"
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-white/5">
          <div className="flex items-center gap-4 mb-4">
            <button 
              onClick={handleHome}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">Injection History</h1>
                <p className="text-white/40 text-sm">View all your past code injections</p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4">
            <div className="px-4 py-2 rounded-xl bg-[#0f1115] border border-white/10">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-sm">
                  <span className="font-medium text-white">{injectionHistory.filter(i => i.success).length}</span>
                  <span className="text-white/40 ml-1">successful</span>
                </span>
              </div>
            </div>
            <div className="px-4 py-2 rounded-xl bg-[#0f1115] border border-white/10">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm">
                  <span className="font-medium text-white">{injectionHistory.filter(i => !i.success).length}</span>
                  <span className="text-white/40 ml-1">failed</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Injection List */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="space-y-4 max-w-4xl">
            {injectionHistory.map((injection, index) => (
              <motion.div
                key={injection.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-[#0f1115] border border-white/10 rounded-2xl p-5 hover:border-blue-500/30 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      injection.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'
                    }`}>
                      {injection.success ? 
                        <CheckCircle className="w-5 h-5 text-emerald-400" /> : 
                        <XCircle className="w-5 h-5 text-red-400" />
                      }
                    </div>
                    <div>
                      <h3 className="text-white font-medium mb-1">{injection.modName}</h3>
                      <p className="text-white/60 text-sm mb-2">{injection.description}</p>
                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(injection.timestamp)}
                        </span>
                        <span>•</span>
                        <span>{injection.appName}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => deleteInjection(injection.id)}
                    className="p-2 hover:bg-red-500/10 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-white/40 hover:text-red-400 transition-colors" />
                  </button>
                </div>

                {/* Code Preview */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-white/60 hover:text-white/80 flex items-center gap-2 transition-colors">
                    <Code className="w-4 h-4" />
                    View code
                  </summary>
                  <pre className="mt-3 p-4 bg-[#0a0a0f] rounded-xl text-xs text-white/60 font-mono overflow-x-auto border border-white/10">
                    {injection.code}
                  </pre>
                </details>
              </motion.div>
            ))}

            {injectionHistory.length === 0 && (
              <div className="text-center py-20">
                <History className="w-16 h-16 mx-auto mb-4 text-white/20" />
                <p className="text-white/40 text-lg">No injections yet</p>
                <p className="text-white/20 text-sm mt-2">Start modding apps to see your history here</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* API Key Change Modal */}
      <ApiKeyChangeModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </div>
  )
}
