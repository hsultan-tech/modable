import { useState, useEffect } from 'react'
import { Layers, History, Settings, LogOut, Command, PanelLeftClose, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LayerEdge } from './LayerEdge'

interface DashboardSidebarProps {
  onLogout?: () => void
  onRefresh?: () => void
  onHistory?: () => void
  onOpenCommandPalette?: () => void
  onSettings?: () => void
  activeView?: string
  /** Icon-only utility rail, fixed. The index gives its width to the surface,
   *  so it opts out of the resizable navigation the other screens use. */
  compact?: boolean
}

export function DashboardSidebar({
  onLogout,
  onRefresh,
  onHistory,
  onOpenCommandPalette,
  onSettings,
  activeView = 'dashboard',
  compact = false,
}: DashboardSidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth')
    return saved ? parseInt(saved) : 224
  })
  const [isResizing, setIsResizing] = useState(false)
  const [collapsedPref, setIsCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const isCollapsed = compact || collapsedPref

  // only persist a choice the user actually made, not the forced compact rail
  useEffect(() => { localStorage.setItem('sidebarCollapsed', String(collapsedPref)) }, [collapsedPref])
  useEffect(() => { localStorage.setItem('sidebarWidth', String(sidebarWidth)) }, [sidebarWidth])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      setSidebarWidth(Math.min(Math.max(196, e.clientX), 340))
    }
    const handleMouseUp = () => setIsResizing(false)
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  if (compact) {
    return (
      <UtilityDock
        activeView={activeView}
        onLogout={onLogout}
        onRefresh={onRefresh}
        onHistory={onHistory}
        onOpenCommandPalette={onOpenCommandPalette}
        onSettings={onSettings}
      />
    )
  }

  const navItems = [
    { id: 'dashboard', icon: Layers, label: 'Surfaces', onClick: onRefresh },
    { id: 'history', icon: History, label: 'History', onClick: onHistory },
    { id: 'settings', icon: Settings, label: 'Settings', onClick: onSettings },
  ]

  return (
    <aside
      className="mdb-aside flex flex-col relative shrink-0"
      style={{ width: isCollapsed ? '56px' : `${sidebarWidth}px`, transition: isResizing ? 'none' : 'width 0.2s ease' }}
    >
      {/* macOS traffic lights live here — the strip stays empty on purpose */}
      <div className="titlebar-drag h-10 shrink-0" />

      <div className={cn('h-11 flex items-center shrink-0', isCollapsed ? 'justify-center px-3' : 'px-4')}>
        <button
          onClick={onRefresh}
          className="flex items-center gap-3 no-drag hover:opacity-75 transition-opacity"
          title="Modable — surface index"
        >
          {/* the mark is the signature glyph itself — a written layer on top of
              the application's own */}
          <LayerEdge written={1} reachable slots={4} className="w-[7px] h-[19px] shrink-0" />
          {!isCollapsed && (
            <span className="mdb-display text-[12px] tracking-[0.06em]">Modable</span>
          )}
        </button>
      </div>

      <div className={cn('pt-3', isCollapsed ? 'px-3' : 'px-3')}>
        <button
          onClick={onOpenCommandPalette}
          className={cn('mdb-btn w-full', isCollapsed ? 'px-0' : 'justify-start')}
          title="Quick actions"
        >
          <Command size={11} />
          {!isCollapsed && (
            <>
              <span>Actions</span>
              <span className="mdb-kbd ml-auto">⌘K</span>
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 pt-4 px-3">
        <div className="space-y-0.5">
          {navItems.map(item => (
            <NavItem
              key={item.id}
              icon={<item.icon size={14} strokeWidth={1.75} />}
              label={item.label}
              active={activeView === item.id}
              onClick={item.onClick}
              collapsed={isCollapsed}
            />
          ))}
        </div>
      </nav>

      <div className="px-3 pb-3 space-y-0.5">
        {/* The rail is fixed when compact, so this toggle could change the
            stored preference but never move anything — a control that does
            nothing is worse than no control. */}
        {!compact && (
          <button
            onClick={() => setIsCollapsed(!collapsedPref)}
            className={cn('mdb-nav', isCollapsed && 'justify-center')}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <PanelLeft size={14} strokeWidth={1.75} /> : <PanelLeftClose size={14} strokeWidth={1.75} />}
            {!isCollapsed && <span className="text-[12.5px] ml-2.5">Collapse</span>}
          </button>
        )}
        <button
          onClick={onLogout}
          className={cn('mdb-nav', isCollapsed && 'justify-center')}
          title={isCollapsed ? 'Log out' : undefined}
        >
          <LogOut size={14} strokeWidth={1.75} />
          {!isCollapsed && <span className="text-[12.5px] ml-2.5">Log out</span>}
        </button>
      </div>

      {!isCollapsed && (
        <div
          className="mdb-resize absolute top-0 right-0 w-[3px] h-full cursor-col-resize"
          onMouseDown={() => setIsResizing(true)}
        />
      )}
    </aside>
  )
}

function NavItem({ icon, label, active, onClick, collapsed }: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  collapsed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn('mdb-nav', active && 'mdb-nav-on', collapsed && 'justify-center')}
      title={collapsed ? label : undefined}
    >
      {active && <span className="mdb-nav-mark" />}
      {icon}
      {!collapsed && <span className="text-[12.5px] ml-2.5">{label}</span>}
    </button>
  )
}

/**
 * The home screen's navigation: a small floating dock, inset from the window
 * edge, rather than a full-height sidebar. The Modable mark sits at the top;
 * clicking it folds the dock down to just the mark (hovering the mark while
 * folded reveals the icons). The dock lives in a fixed-width lane, so the
 * stage beside it measures the real space left for the hero.
 */
function UtilityDock({ activeView, onLogout, onRefresh, onHistory, onOpenCommandPalette, onSettings }: {
  activeView: string
  onLogout?: () => void
  onRefresh?: () => void
  onHistory?: () => void
  onOpenCommandPalette?: () => void
  onSettings?: () => void
}) {
  const [folded, setFolded] = useState(() => localStorage.getItem('dockFolded') === 'true')
  useEffect(() => { localStorage.setItem('dockFolded', String(folded)) }, [folded])
  const [peek, setPeek] = useState(false)
  const open = !folded || peek

  const item = (id: string, Icon: typeof Layers, label: string, onClick?: () => void) => (
    <button
      key={id}
      type="button"
      className="mdb-dock-i"
      data-active={activeView === id ? '' : undefined}
      aria-current={activeView === id ? 'page' : undefined}
      onClick={onClick}
      title={label}
      aria-label={label}
      tabIndex={open ? 0 : -1}
    >
      <Icon size={15} strokeWidth={1.6} />
    </button>
  )

  return (
    <aside className="mdb-aside mdb-dock-lane shrink-0 relative">
      <div className="titlebar-drag h-10" />
      <nav
        className="mdb-dock no-drag"
        data-open={open ? '' : undefined}
        onMouseLeave={() => setPeek(false)}
        aria-label="Navigation"
      >
        <button
          type="button"
          className="mdb-dock-mark"
          onClick={() => { setFolded(f => !f); setPeek(false) }}
          onMouseEnter={() => folded && setPeek(true)}
          onFocus={() => folded && setPeek(true)}
          title={folded ? 'Show navigation' : 'Fold navigation'}
          aria-expanded={!folded}
        >
          <LayerEdge written={1} reachable slots={4} className="w-[6px] h-[17px]" />
        </button>
        <div className="mdb-dock-items" aria-hidden={!open}>
          <div className="mdb-dock-inner">
            {item('actions', Command, 'Quick actions  ⌘K', onOpenCommandPalette)}
            <span className="mdb-dock-rule" />
            {item('dashboard', Layers, 'Surfaces', onRefresh)}
            {item('history', History, 'History', onHistory)}
            {item('settings', Settings, 'Settings', onSettings)}
            <span className="mdb-dock-rule" />
            {item('logout', LogOut, 'Log out', onLogout)}
          </div>
        </div>
      </nav>
    </aside>
  )
}
