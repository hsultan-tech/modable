import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useAppStore } from './stores/projectStore'
import './index.css'

// Design/QA affordance: drive UI states (including the Surface Injection
// sequence) from the console without a live target app. Dev builds only.
if (import.meta.env.DEV) {
  ;(window as unknown as { modable: unknown }).modable = useAppStore
}

/**
 * Refuse every drop the app did not ask for.
 *
 * Electron's default for a file dropped on a window is to navigate to it, which
 * replaces Modable with a file listing or a media player and loses whatever the
 * user was doing. The prompt input handles its own drop; everything outside it
 * must do nothing at all rather than something destructive.
 */
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, event => {
    const target = event.target as HTMLElement | null
    if (target && target instanceof HTMLInputElement) return
    event.preventDefault()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
