import { useRef, useEffect, useState } from 'react'
import { Search, History, RefreshCw, Key, LogOut, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onCommand?: (command: CommandAction) => void
}

export type CommandAction = 
  | { type: 'scan-apps' }
  | { type: 'view-history' }
  | { type: 'change-api-key' }
  | { type: 'logout' }
  | { type: 'select-app'; appName: string }

const COMMANDS = [
  { 
    id: 'scan-apps', 
    label: 'Scan for apps', 
    icon: RefreshCw, 
    shortcut: '⌘R',
    action: { type: 'scan-apps' as const }
  },
  { 
    id: 'view-history', 
    label: 'View injection history', 
    icon: History, 
    shortcut: '⌘H',
    action: { type: 'view-history' as const }
  },
  { 
    id: 'change-api-key', 
    label: 'Change API key', 
    icon: Key, 
    shortcut: '⌘⇧K',
    action: { type: 'change-api-key' as const }
  },
  { 
    id: 'logout', 
    label: 'Logout', 
    icon: LogOut, 
    action: { type: 'logout' as const }
  },
]

export function CommandPalette({ isOpen, onClose, onCommand }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filteredCommands = query
    ? COMMANDS.filter(cmd => 
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : COMMANDS

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filteredCommands[selectedIndex]
        if (cmd) {
          onCommand?.(cmd.action)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, filteredCommands, selectedIndex, onCommand])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
                <Search size={18} className="text-white/40" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-white placeholder-white/40 text-sm outline-none"
                />
                <span className="px-2 py-0.5 text-xs text-white/50 bg-white/5 rounded border border-white/10">
                  Esc
                </span>
              </div>

              {/* Commands list */}
              <div className="p-2 max-h-96 overflow-y-auto">
                {filteredCommands.length > 0 ? (
                  <div className="text-xs text-white/30 px-2 py-1 uppercase tracking-wider mb-1">
                    Quick Actions
                  </div>
                ) : null}
                
                {filteredCommands.map((cmd, index) => {
                  const Icon = cmd.icon
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        onCommand?.(cmd.action)
                        onClose()
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors text-left ${
                        selectedIndex === index
                          ? 'bg-white/10 text-white'
                          : 'text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={16} className={selectedIndex === index ? 'text-white' : 'text-white/40'} />
                        <span className="text-sm">{cmd.label}</span>
                      </div>
                      {cmd.shortcut && (
                        <span className="text-xs text-white/30 font-mono">{cmd.shortcut}</span>
                      )}
                    </button>
                  )
                })}

                {filteredCommands.length === 0 && query && (
                  <div className="text-center py-8">
                    <Search className="w-12 h-12 mx-auto mb-3 text-white/20" />
                    <p className="text-white/40 text-sm">No commands found</p>
                    <p className="text-white/20 text-xs mt-1">Try a different search term</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Hook to manage command palette state
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  }
}
