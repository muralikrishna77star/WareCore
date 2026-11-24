'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PlayCircle } from 'lucide-react'
import { useBrand } from '@/components/BrandProvider'

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_denied: 'Google sign-in was cancelled.',
  not_registered: 'Your Google account is not registered in WareCore. Contact your administrator.',
  unverified_email: 'Your Google email address is not verified.',
  google_not_configured: 'Google sign-in is not configured yet.',
  google_unavailable_offline: 'Google sign-in is not available in the offline desktop app.',
  token_failed: 'Google sign-in failed. Please try again.',
  invalid_state: 'Authentication error. Please try again.',
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const brand = useBrand()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const [desktopGoogleAvailable, setDesktopGoogleAvailable] = useState(false)

  useEffect(() => {
    fetch('/api/desktop/status')
      .then((res) => res.json())
      .then((data) => {
        setIsDesktop(!!data.isDesktop)
        setDesktopGoogleAvailable(!!data.googleOAuthAvailable)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => {
      const errorParam = searchParams.get('error')
      if (errorParam) {
        setError(GOOGLE_ERROR_MESSAGES[errorParam] ?? 'An error occurred. Please try again.')
      }
    })
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Login failed')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-blue-900 to-indigo-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="wc-float absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/30 blur-3xl" />
            <div className="wc-float absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-indigo-500/30 blur-3xl [animation-delay:-4s]" />
            <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgb(255_255_255)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.07] to-transparent" />
          </div>
      <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG, no next/image optimization needed */}
          <img src={brand.logoUrl} alt={brand.displayName} className="h-16 max-w-[13rem] rounded-2xl p-2.5 bg-gradient-to-b from-white to-blue-50 object-contain ring-1 ring-white/70 shadow-[inset_0_1px_0_white,0_12px_40px_-8px_rgb(56_189_248/0.6)]" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight">
          <span className="wc-gloss-text">{brand.displayName}</span>
        </h2>
        <p className="mt-2 text-center text-sm text-blue-100">
          {brand.isCustomer ? 'Warehouse Management by WareCore' : 'Warehouse Management System'}
        </p>
      </div>

      <div className="relative mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="wc-glass py-8 px-4 sm:rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email or username
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="text"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link
                  href="/login/forgot-password"
                  className="text-sm font-medium text-blue-600 hover:text-blue-500"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="wc-shine wc-gloss flex w-full justify-center rounded-lg border border-transparent bg-gradient-to-b from-blue-500 to-blue-700 py-2.5 px-4 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <span className="relative">{loading ? 'Signing in...' : 'Sign in'}</span>
              </button>
            </div>
          </form>

          {(isDesktop ? desktopGoogleAvailable : process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true' && brand.googleSignIn) && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="rounded bg-white px-2 text-gray-500">Or continue with</span>
                </div>
              </div>

              <div className="mt-6">
                <a
                  href="/api/auth/google"
                  className="flex w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Sign in with Google
                </a>
              </div>
            </div>
          )}
        </div>

        {/* On a customer's address (bsm.warecore.space) /tour is that
            customer's tour, open without signing in. */}
        {brand.isCustomer && (
          <Link
            href="/tour"
            className="wc-shine mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/10 py-2.5 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] backdrop-blur-md hover:bg-white/20"
          >
            <PlayCircle className="h-5 w-5" aria-hidden="true" /> Take the Product Tour
          </Link>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
