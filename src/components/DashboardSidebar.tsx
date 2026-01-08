import { useState, useEffect } from 'react'
import { 
  LayoutDashboard, History, Settings, LogOut, 
  Command, PanelLeftClose, PanelLeft
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardSidebarProps {
  onLogout?: () => void
  onRefresh?: () => void
  onHistory?: () => void
  onOpenCommandPalette?: () => void
  onSettings?: () => void
  activeView?: string
}

export function DashboardSidebar({ 
  onLogout, 
  onRefresh, 
  onHistory, 
  onOpenCommandPalette,
  onSettings,
  activeView = 'dashboard' 
}: DashboardSidebarProps) {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth')
    return saved ? parseInt(saved) : 256
  })
  const [isResizing, setIsResizing] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed')
    return saved === 'true'
  })

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(isCollapsed))
  }, [isCollapsed])

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('sidebarWidth', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = Math.min(Math.max(200, e.clientX), 400)
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  // Toggle collapse
  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed)
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric' 
    }).toUpperCase()
  }

  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', onClick: onRefresh },
    { id: 'history', icon: History, label: 'History', onClick: onHistory },
    { id: 'settings', icon: Settings, label: 'Settings', onClick: onSettings },
  ]

  return (
    <aside 
      className="flex flex-col bg-[#0a0a0f] border-r border-white/5 relative transition-all duration-300"
      style={{ width: isCollapsed ? '72px' : `${sidebarWidth}px` }}
    >
      {/* Logo */}
      <div className="px-4 pt-4 pb-3">
        <button 
          onClick={onRefresh}
          className="w-full flex items-center gap-3 hover:opacity-80 transition-all group px-1"
          title="Go to Dashboard"
        >
          <div className="w-8 h-8 flex items-center justify-center relative shrink-0">
            <img 
              src="/logo-m.png" 
              alt="Modable" 
              className="w-full h-full object-contain drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] group-hover:drop-shadow-[0_0_12px_rgba(59,130,246,0.7)] transition-all"
            />
          </div>
          {!isCollapsed && (
            <span className="text-lg font-bold text-white tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">Modable</span>
          )}
        </button>
      </div>

      {/* Collapse Toggle Button */}
      <div className={cn("px-4 pb-3", isCollapsed && "px-3")}>
        <button
          onClick={toggleCollapse}
          className="w-full px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all flex items-center justify-center gap-2 group"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeft size={16} className="text-white/60 group-hover:text-white/80" />
          ) : (
            <>
              <PanelLeftClose size={14} className="text-white/60 group-hover:text-white/80" />
              <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors">Collapse</span>
            </>
          )}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* User Profile - Compact */}
          <div className="px-4 pb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-[#0f1115] to-[#0a0a0f] border border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <span className="text-xs font-semibold text-white">HS</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/40 truncate">{formatDate(currentTime).split(',')[0]}</p>
                  <p className="text-sm font-medium text-white">Welcome back</p>
                </div>
                <button className="text-white/30 hover:text-white transition-colors">
                  <Settings size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Command Palette - Compact */}
          <div className="px-4 pb-3">
            <button 
              onClick={onOpenCommandPalette}
              className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 hover:border-blue-500/40 transition-all flex items-center gap-2 group"
            >
              <Command size={14} className="text-blue-400" />
              <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors">Quick actions</span>
              <div className="ml-auto flex items-center gap-0.5">
                <kbd className="px-1 py-0.5 rounded bg-white/10 text-[9px] text-white/40 font-medium">⌘K</kbd>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Navigation - Compact */}
      <nav className={cn("flex-1", isCollapsed ? "px-3" : "px-4")}>
        <div className="space-y-0.5">
          {navItems.map((item) => (
            <NavItem 
              key={item.id}
              icon={<item.icon size={16} />}
              label={item.label}
              active={activeView === item.id}
              onClick={item.onClick}
              collapsed={isCollapsed}
            />
          ))}
        </div>
      </nav>

      {/* Logout */}
      <div className={cn("p-4 pt-2", isCollapsed && "px-3")}>
        <button 
          onClick={onLogout}
          className={cn(
            "w-full px-3 py-2 rounded-lg hover:bg-white/5 transition-colors flex items-center text-white/40 hover:text-white",
            isCollapsed ? "justify-center" : "gap-2"
          )}
          title={isCollapsed ? "Log out" : undefined}
        >
          <LogOut size={16} />
          {!isCollapsed && <span className="text-xs">Log out</span>}
        </button>
      </div>

      {/* Resize Handle - Only show when expanded */}
      {!isCollapsed && (
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors group"
          onMouseDown={() => setIsResizing(true)}
        >
          <div className="absolute top-1/2 right-0 -translate-y-1/2 w-1 h-12 bg-blue-500/0 group-hover:bg-blue-500/50 transition-colors rounded-l" />
        </div>
      )}
    </aside>
  )
}

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  collapsed?: boolean
}

function NavItem({ icon, label, active, onClick, collapsed }: NavItemProps) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2 rounded-lg transition-all flex items-center group",
        collapsed ? "justify-center" : "gap-2.5",
        active 
          ? "bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-white border border-blue-500/30" 
          : "text-white/50 hover:bg-white/5 hover:text-white/80 border border-transparent"
      )}
      title={collapsed ? label : undefined}
    >
      <div className={cn(
        "transition-colors",
        active ? "text-blue-400" : "text-white/40 group-hover:text-white/60"
      )}>
        {icon}
      </div>
      {!collapsed && (
        <>
          <span className="text-sm font-medium">{label}</span>
          {active && (
            <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
          )}
        </>
      )}
      {collapsed && active && (
        <div className="absolute right-1 w-1 h-6 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
      )}
    </button>
  )
}



