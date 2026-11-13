import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import DemoBar from './demo/DemoBar'
import { bootDemo } from './demo/boot'
import './styles/tokens.css'
import './index.css'

// Demo build: load (or seed) this browser's demo data first; nothing talks to a server.
bootDemo().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
        <DemoBar />
      </BrowserRouter>
    </StrictMode>,
  ),
)
