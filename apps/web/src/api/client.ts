import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/auth.store'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Decode the JWT exp claim. Treats anything malformed or within 30s of expiry
// as expired — that grace window avoids a request racing the network and
// arriving at the server after the token has flipped to invalid.
function isAccessTokenExpired(token: string | null): boolean {
  if (!token) return true
  try {
    const [, payloadB64] = token.split('.')
    if (!payloadB64) return true
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(json).exp
    if (typeof exp !== 'number') return true
    return Date.now() + 30_000 >= exp * 1000
  } catch {
    return true
  }
}

let prefetchPromise: Promise<void> | null = null

// Cold-load helper: if we have a persisted user but the stored access token
// is missing or expired, swap it out before any protected request goes out.
// Without this, every page reload triggers a noisy 401 → refresh → retry
// cycle on each query the dashboard fans out in parallel.
async function ensureFreshAccessToken(): Promise<void> {
  const { user, accessToken } = useAuthStore.getState()
  if (!user) return
  if (!isAccessTokenExpired(accessToken)) return
  if (prefetchPromise) return prefetchPromise

  prefetchPromise = (async () => {
    try {
      const subdomain = useAuthStore.getState().tenantSubdomain
      const { data } = await axios.post<{ success: boolean; data: { accessToken: string } }>(
        '/api/auth/refresh',
        {},
        { withCredentials: true, headers: subdomain ? { 'X-Tenant-Subdomain': subdomain } : {} },
      )
      useAuthStore.getState().setAccessToken(data.data.accessToken)
    } catch {
      // Let the response interceptor handle the failure surface (toast + logout)
      // when the next protected request still comes back 401.
    } finally {
      prefetchPromise = null
    }
  })()
  return prefetchPromise
}

// Attach access token + tenant subdomain to every request. If the stored token
// is stale, refresh it inline so the request goes out already authenticated.
api.interceptors.request.use(async (config) => {
  await ensureFreshAccessToken()
  const { accessToken, tenantSubdomain } = useAuthStore.getState()
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  if (tenantSubdomain) config.headers['X-Tenant-Subdomain'] = tenantSubdomain
  return config
})

let isRefreshing = false
// Each queued request keeps both a success and a failure handler so a failed
// refresh can REJECT them (settling the promise) instead of leaving them to
// hang forever.
let refreshQueue: Array<{ onToken: (token: string) => void; onError: (err: unknown) => void }> = []

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err)
    }
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          onToken: (token) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          },
          onError: reject,
        })
      })
    }
    original._retry = true
    isRefreshing = true
    try {
      const subdomain = useAuthStore.getState().tenantSubdomain
      const { data } = await axios.post<{ success: boolean; data: { accessToken: string } }>(
        '/api/auth/refresh',
        {},
        { withCredentials: true, headers: subdomain ? { 'X-Tenant-Subdomain': subdomain } : {} },
      )
      const newToken = data.data.accessToken
      useAuthStore.getState().setAccessToken(newToken)
      refreshQueue.forEach((q) => q.onToken(newToken))
      refreshQueue = []
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch (refreshErr) {
      // Refresh failed — reject every queued request so they settle (instead of
      // hanging forever) and each caller's catch runs; surface a toast so the
      // user understands why the next click bounces them to /login.
      refreshQueue.forEach((q) => q.onError(refreshErr ?? err))
      refreshQueue = []
      const state = useAuthStore.getState()
      if (state.accessToken || state.user) {
        toast.error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً')
      }
      state.logout()
      return Promise.reject(refreshErr ?? err)
    } finally {
      isRefreshing = false
    }
  },
)
