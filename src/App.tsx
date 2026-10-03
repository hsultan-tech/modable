import { useState } from 'react'
import { useAppStore } from './stores/projectStore'
import { ApiKeyModal } from './components/ApiKeyModal'
import { Dashboard } from './components/Dashboard'
import { ModWorkspace } from './components/ModWorkspace'
import { InjectionHistory } from './components/InjectionHistory'

type View = 'apps' | 'workspace' | 'history' | 'settings'

export default function App() {
  const { apiKey, selectedApp } = useAppStore()
  const [currentView, setCurrentView] = useState<View>('apps')
  
  if (!apiKey) {
    return <ApiKeyModal />
  }

  // If history view is requested, show it
  if (currentView === 'history') {
    return <InjectionHistory onBack={() => setCurrentView('apps')} />
  }
  
  // Normal flow
  if (!selectedApp) {
    return <Dashboard onNavigateToHistory={() => setCurrentView('history')} />
  }

  return <ModWorkspace onNavigateToHistory={() => setCurrentView('history')} />
}
