import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyUrlParams } from './lib/urlParams'
import './styles/global.css'
import './styles/components.css'
import './styles/agentbar.css'
// last: responsive breakpoints + cross-sheet chrome overrides always win
import './styles/overrides.css'

applyUrlParams()

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root element in index.html')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
