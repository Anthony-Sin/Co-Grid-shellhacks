import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyUrlParams } from './lib/urlParams'
import './styles/global.css'

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
