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
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false)
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
        className="w-7 h-7 rounded-md flex items-center justify-center no-drag text-[var(--fg-2)] hover:text-[var(--fg-0)] transition-colors"
        style={{ background: 'var(--ink-3)', boxShadow: 'inset 0 1px 0 var(--lift)' }}
        aria-label="Account"
      >
        <User size={13} strokeWidth={1.75} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 mt-2 w-52 rounded-lg overflow-hidden z-50 p-1.5"
            style={{ background: 'var(--ink-2)', boxShadow: 'inset 0 1px 0 var(--lift-2), 0 14px 40px rgba(0,0,0,0.6), 0 0 0 1px var(--hair)' }}
          >
            <MenuItem icon={<Key size={13} strokeWidth={1.75} />} label="Change API key"
              onClick={() => { setIsOpen(false); onChangeApiKey() }} />
            {onViewHistory && (
              <MenuItem icon={<History size={13} strokeWidth={1.75} />} label="History"
                onClick={() => { setIsOpen(false); onViewHistory() }} />
            )}
            <hr className="mdb-rule my-1.5" />
            <MenuItem icon={<LogOut size={13} strokeWidth={1.75} />} label="Log out"
              onClick={() => { setIsOpen(false); onLogout() }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mdb-nav h-8 gap-2.5">
      {icon}
      <span className="text-[12.5px]">{label}</span>
    </button>
  )
}

export function ApiKeyChangeModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { setApiKey } = useAppStore()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.trim()) return setError('Enter an API key')
    if (!newKey.startsWith('sk-')) return setError('An OpenAI key starts with sk-')
    setApiKey(newKey.trim())
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="mdb-over fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(9,8,7,0.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[400px] mx-4 rounded-xl p-6"
        style={{ background: 'var(--ink-2)', boxShadow: 'inset 0 1px 0 var(--lift-2), 0 30px 80px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="mdb-label mb-2">Account</div>
            <h3 className="mdb-display text-[17px]">Change API key</h3>
          </div>
          <button onClick={onClose} className="text-[var(--fg-3)] hover:text-[var(--fg-0)] transition-colors" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={newKey}
            onChange={e => { setNewKey(e.target.value); setError(null) }}
            placeholder="sk-proj-…"
            autoFocus
            className="mdb-input px-3.5 py-2.5 text-[13px] outline-none"
          />
          {error && <p className="text-[11.5px]" style={{ color: 'var(--fault)' }}>{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={onClose} className="mdb-btn flex-1 h-9">Cancel</button>
            <button type="submit" className="mdb-btn mdb-btn-write flex-1 h-9">Save key</button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
