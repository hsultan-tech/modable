import { useState } from 'react'
import { Key, Eye, EyeOff, ArrowRight, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { TextAnimate } from './TextAnimate'

export function ApiKeyModal() {
  const { setApiKey } = useAppStore()
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) { 
      setError('Please enter an API key')
      return 
    }
    // Allow test keys for demo purposes
    if (!key.startsWith('sk-') && key !== 'test' && key !== 'demo') { 
      setError('Invalid API key format (use sk-... or "test" for demo)')
      return 
    }
    setApiKey(key.trim())
  }

  return (
    <div className="h-full w-full bg-[#0a0a0f] flex items-center justify-center p-8">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Logo & Title */}
        <div className="flex items-center gap-4 mb-10">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center"
          >
            <Zap className="w-6 h-6 text-white" />
          </motion.div>
          <div>
            <h1 className="text-2xl font-semibold text-white">Modable</h1>
            <p className="text-white/50 text-sm">AI-powered app modding</p>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-[#0f1115] border border-white/10 rounded-2xl p-6">
          <div className="mb-6">
            <TextAnimate 
              animation="blurInUp" 
              by="word" 
              className="text-xl font-medium text-white mb-2"
              startOnView={false}
            >
              Welcome back
            </TextAnimate>
            <p className="text-white/50 text-sm">
              Enter your OpenAI API key to get started
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/60">
                API Key
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                <input
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => { setKey(e.target.value); setError(null) }}
                  placeholder="sk-proj-..."
                  className={`w-full py-3 pl-10 pr-10 rounded-xl bg-[#0a0a0f] border text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-colors ${
                    error ? 'border-red-500/50' : 'border-white/10'
                  }`}
                />
                <button 
                  type="button" 
                  onClick={() => setShowKey(!showKey)} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {error && (
                <motion.p 
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-400 text-sm flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {error}
                </motion.p>
              )}
            </div>

            <button 
              type="submit" 
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white font-medium flex items-center justify-center gap-2 hover:from-blue-500 hover:to-blue-400 transition-all"
            >
              Get Started
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/30 text-xs uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <p className="text-white/40 text-sm text-center">
            Need a key?{' '}
            <a 
              href="https://platform.openai.com/api-keys" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Get one from OpenAI →
            </a>
          </p>
        </div>

        {/* Footer */}
        <p className="text-white/30 text-xs text-center mt-6">
          Your API key is stored locally and never shared
        </p>
      </motion.div>
    </div>
  )
}
