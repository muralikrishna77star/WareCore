'use client'

import { useState } from 'react'

export default function OwnerLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/owner/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (res.ok) {
      window.location.href = '/owner'
      return
    }
    const data = await res.json().catch(() => ({}))
    setError(data.error ?? 'Sign-in failed')
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold text-gray-900">Owner sign-in</h1>
      <p className="mt-1 text-sm text-gray-600">For WareCore owners only. Customers sign in at their own address.</p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-lg bg-white p-6 shadow">
        <label className="block text-sm font-medium text-gray-700">
          Email
          <input className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2" type="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Password
          <input className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
