import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initCloud } from './lib/cloud.ts'
import { CLOUD } from './lib/config.ts'
import { initStore } from './lib/store.ts'

// Lokal sofort laden; online erst nach dem Anmelden (siehe App).
if (CLOUD) initCloud()
else void initStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
