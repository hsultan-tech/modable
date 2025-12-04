import { Zap, LogOut, History } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarProps {
  onLogout?: () => void
  onHome?: () => void
  onHistory?: () => void
  onNavigate?: (view: 'home' | 'apps' | 'settings') => void
}

export function Sidebar({ onLogout, onHome, onHistory }: SidebarProps) {
  return (
    <aside className="w-16 flex flex-col justify-between items-center py-6 bg-neutral-900/50 border-r border-white/10">
      <div className="flex flex-col gap-6">
        {/* Logo - Home Button */}
        <button 
          onClick={onHome}
          className="p-2 hover:bg-white/10 rounded transition-colors cursor-pointer"
          title="Home"
        >
          <Zap size={24} className="text-white" />
        </button>

        {/* Divider */}
        <div className="w-8 h-px bg-white/10" />

        {/* History Button */}
        <SidebarButton 
          icon={<History size={20} />} 
          onClick={onHistory}
          title="Injection History"
        />
      </div>

      {/* Bottom section */}
      <div className="flex flex-col gap-4">
        <SidebarButton 
          icon={<LogOut size={20} />} 
          onClick={onLogout}
          title="Logout"
        />
      </div>
    </aside>
  )
}

interface SidebarButtonProps {
  icon: React.ReactNode
  onClick?: () => void
  title?: string
  active?: boolean
}

function SidebarButton({ icon, onClick, title, active }: SidebarButtonProps) {
  return (
    <button 
      onClick={onClick}
      title={title}
      className={cn(
        "p-2 hover:bg-white/10 rounded transition-colors cursor-pointer",
        active && "bg-white/10"
      )}
    >
      {icon}
    </button>
  )
}
