import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from './ui'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** When this changes, the boundary resets. Use the current route path to clear errors on navigation. */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console in dev; in prod this is where you'd ship to Sentry/Bugsnag.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return <DefaultFallback error={error} onReset={this.reset} />
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const isDev = import.meta.env.DEV
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-lg w-full bg-gray-800 border border-gray-700 rounded-xl p-6 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-danger-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-danger-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-100">حدث خطأ غير متوقع</h2>
          <p className="text-sm text-gray-400 mt-1">
            تعطل عرض هذه الصفحة. يمكنك المحاولة مرة أخرى أو الرجوع للرئيسية.
          </p>
        </div>
        {isDev && (
          <details className="w-full text-right">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
              تفاصيل الخطأ (وضع التطوير)
            </summary>
            <pre className="mt-2 text-xs text-danger-600 font-mono bg-gray-800 rounded p-3 overflow-auto max-h-48 text-left" dir="ltr">
              {error.message}
              {error.stack && '\n\n' + error.stack}
            </pre>
          </details>
        )}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={onReset}>
            <RotateCcw className="w-4 h-4" />إعادة المحاولة
          </Button>
          <Button variant="ghost" onClick={() => { window.location.href = '/' }}>
            <Home className="w-4 h-4" />الرئيسية
          </Button>
        </div>
      </div>
    </div>
  )
}
