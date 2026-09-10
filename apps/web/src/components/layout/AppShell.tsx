import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { SubscriptionBanner } from '@/components/SubscriptionBanner'

interface AppShellProps {
  children: ReactNode
  title?: string
}

export function AppShell({ children, title }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Auto-close the mobile drawer on route change (defense in depth: the NavLink
  // onClick already calls onClose, but external nav still needs this).
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-app">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:right-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded-md focus:text-sm focus:font-medium"
      >
        تخطي إلى المحتوى الرئيسي
      </a>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop — only visible when drawer is open on small screens */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="lg:mr-60 flex flex-col min-h-dvh">
        <SubscriptionBanner />
        <TopBar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8 animate-fade-in">{children}</main>
      </div>
    </div>
  )
}
