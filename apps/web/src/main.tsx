import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './styles/globals.css'
import { useAuthStore, type AuthUser } from './stores/auth.store'

// ── Cross-domain session transfer ──────────────────────────────────────────
// After login on the main domain (hesbaapp.com), the user is redirected to
// their store subdomain (akml.hesbaapp.com) with the session encoded in the
// URL hash: #s=<base64(JSON)>. We decode it here — before React renders —
// so the app starts already authenticated and navigates to the right page.
;(function restoreSessionFromHash() {
  const hash = window.location.hash
  if (!hash.startsWith('#s=')) return
  try {
    const { accessToken, user, subdomain } = JSON.parse(atob(hash.slice(3))) as {
      accessToken: string
      user: AuthUser
      subdomain: string
    }
    useAuthStore.getState().setAuth(user, accessToken, subdomain)

    // Decide landing: first login → /settings, otherwise → /pos (or best available)
    const onboardingKey = `hesba_onboarded_${user.id}`
    const can = (r: string, a: string) => user.permissions?.[r]?.includes(a) ?? false
    let destination = '/pos'
    if (!localStorage.getItem(onboardingKey)) {
      localStorage.setItem(onboardingKey, '1')
      destination = '/settings'
    } else if (!can('invoices', 'create')) {
      destination = '/dashboard'
    }

    // Replace hash with the real path so React Router sees the right route
    window.history.replaceState(null, '', destination)
  } catch {
    // Malformed hash — ignore and let the app render normally
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
})()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter
        future={{
          // Opt in to v7 behaviour ahead of the migration: state updates wrapped
          // in React.startTransition, and consistent splat-route resolution.
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#1E293B',
              color: '#F1F5F9',
              border: '1px solid #334155',
              fontFamily: 'IBM Plex Sans Arabic, sans-serif',
              direction: 'rtl',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
