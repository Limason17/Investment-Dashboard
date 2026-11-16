import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import { initCloud } from './lib/cloud.ts'
import { CLOUD } from './lib/config.ts'
import { initStore } from './lib/store.ts'

/**
 * Schutz gegen Einbetten (Clickjacking): GitHub Pages kann keinen Header gegen fremde Rahmen senden.
 * Läuft die App im Rahmen einer fremden Seite, startet sie nicht und zeigt nur einen Link zur echten Seite.
 */
function framedByOther() {
  if (window.top === window.self) return false
  try {
    return window.top!.location.origin !== window.location.origin
  } catch {
    return true
  }
}

const root = document.getElementById('root')!
if (framedByOther()) {
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;font:15px/1.5 system-ui,sans-serif;color:#e8e9ec;background:#07080a'
  const p = document.createElement('p')
  p.textContent = 'Depot läuft hier in einer fremden Seite. Zu deinem Schutz startet es nur in einem eigenen Fenster.'
  const a = document.createElement('a')
  a.href = window.location.href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.textContent = 'Depot in eigenem Fenster öffnen'
  a.style.cssText = 'display:inline-block;margin-top:12px;color:#7cc4ff'
  const inner = document.createElement('div')
  inner.append(p, a)
  box.append(inner)
  root.replaceChildren(box)
} else {
  // Lokal sofort laden; online erst nach dem Anmelden (siehe App).
  if (CLOUD) initCloud()
  else void initStore()

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
