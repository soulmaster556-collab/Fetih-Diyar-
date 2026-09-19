import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminPanel from './AdminPanel.tsx'

// Hash-based check on purpose: a path-based route like /admin needs the static
// host to rewrite unknown paths back to index.html, which isn't reliably
// configured on every host. The hash never reaches the server at all, so
// this works with zero server-side configuration.
const isAdmin = window.location.hash.startsWith('#admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminPanel /> : <App />}
  </StrictMode>,
)
