import { useState, useRef, useEffect } from 'react'
import { User, Key, History, LogOut, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'

interface ProfileMenuProps {
  onChangeApiKey: () => void
  onViewHistory?: () => void
  onLogout: () => void
}

export function ProfileMenu({ onChangeApiKey, onViewHistory, onLogout }: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 bg-white/10 rounded-full flex items-center justify-center no-drag hover:bg-white/20 transition-colors"
      >
        <User size={16} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-56 rounded-xl bg-neutral-900 border border-white/10 shadow-2xl overflow-hidden z-50"
          >
            <div className="p-2">
              <MenuItem
                icon={<Key size={16} />}
                label="Change API Key"
                onClick={() => {
                  setIsOpen(false)
                  onChangeApiKey()
                }}
              />
              {onViewHistory && (
                <MenuItem
                  icon={<History size={16} />}
                  label="View History"
                  onClick={() => {
                    setIsOpen(false)
                    onViewHistory()
                  }}
                />
              )}
              <div className="my-1 h-px bg-white/10" />
              <MenuItem
                icon={<LogOut size={16} />}
                label="Logout"
                onClick={() => {
                  setIsOpen(false)
                  onLogout()
                }}
                destructive
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ 
  icon, 
  label, 
  onClick, 
  destructive 
}: { 
  icon: React.ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
        destructive 
          ? 'text-red-400 hover:bg-red-500/10' 
          : 'text-white/80 hover:bg-white/10 hover:text-white'
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  )
}

// API Key Change Modal
interface ApiKeyChangeModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ApiKeyChangeModal({ isOpen, onClose }: ApiKeyChangeModalProps) {
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { setApiKey } = useAppStore()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.trim()) {
      setError('Please enter an API key')
      return
    }
    if (!newKey.startsWith('sk-')) {
      setError('Invalid API key format')
      return
    }
    setApiKey(newKey.trim())
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Change API Key</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <X size={20} className="text-white/60" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-white/60 mb-2 block">
              OpenAI API Key
            </label>
            <input
              type="password"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value)
                setError(null)
              }}
              placeholder="sk-proj-..."
              className="w-full px-3 py-2 bg-neutral-800 border border-white/10 rounded-lg text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            {error && (
              <p className="text-red-400 text-sm mt-2">{error}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-white hover:bg-white/90 text-black rounded-lg font-medium transition-colors"
            >
              Update Key
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

