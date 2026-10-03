import { useRef, useEffect, useState } from 'react'
import { Search, History, RefreshCw, Key, LogOut } from 'lucide-react'
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
    label: 'Open history', 
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
    label: 'Log out', 
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
          <div className="absolute inset-0" style={{ background: 'rgba(9,8,7,0.78)', backdropFilter: 'blur(6px)' }} />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: 'var(--ink-2)', boxShadow: 'inset 0 1px 0 var(--lift-2), 0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px var(--hair)' }}
            >
              <div className="flex items-center gap-3 px-4 py-3.5" style={{ boxShadow: 'inset 0 -1px 0 var(--hair)' }}>
                <Search size={14} className="text-[var(--fg-3)]" strokeWidth={1.75} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search actions"
                  className="flex-1 bg-transparent text-[13.5px] text-[var(--fg-0)] placeholder:text-[var(--fg-3)] outline-none"
                />
                <span className="mdb-kbd">esc</span>
              </div>

              {/* Commands list */}
              <div className="p-1.5 max-h-96 overflow-y-auto">
                {filteredCommands.length > 0 ? (
                  <div className="mdb-label px-2.5 pt-2 pb-2.5">Actions</div>
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
                      className="w-full flex items-center justify-between px-2.5 h-9 rounded-md transition-colors text-left"
                      style={selectedIndex === index
                        ? { background: 'var(--ink-3)', color: 'var(--fg-0)', boxShadow: 'inset 0 1px 0 var(--lift)' }
                        : { color: 'var(--fg-1)' }}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={13} strokeWidth={1.75} style={{ color: selectedIndex === index ? 'var(--fg-0)' : 'var(--fg-3)' }} />
                        <span className="text-[13px]">{cmd.label}</span>
                      </div>
                      {cmd.shortcut && <span className="mdb-kbd">{cmd.shortcut}</span>}
                    </button>
                  )
                })}

                {filteredCommands.length === 0 && query && (
                  <div className="px-3 py-10 text-center">
                    <p className="text-[13px] text-[var(--fg-2)]">No action matches “{query}”</p>
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
