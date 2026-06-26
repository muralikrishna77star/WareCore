'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [mode, setMode] = useState<'create' | 'restore'>('create')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreData, setRestoreData] = useState<{ data?: Record<string, unknown[]> } | null>(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/setup')
      .then((res) => res.json())
      .then((data) => {
        setNeedsSetup(!!data.needsSetup)
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, email, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Setup failed')
      setLoading(false)
      return
    }

    router.push('/login')
  }

  const handleRestoreFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setRestoreFile(file)
    setRestoreData(null)
    setRestoreError(null)

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        if (!parsed?.data || typeof parsed.data !== 'object') {
          setRestoreError('This file is not a valid backup export.')
          return
        }
        setRestoreData(parsed)
      } catch {
        setRestoreError('Could not read this file as JSON.')
      }
    }
    reader.readAsText(file)
  }

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!restoreData) return
    setRestoreLoading(true)
    setRestoreError(null)

    const res = await fetch('/api/auth/setup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupData: restoreData }),
    })
    const data = await res.json()

    if (!res.ok) {
      setRestoreError(data.error ?? 'Restore failed')
      setRestoreLoading(false)
      return
    }

    router.push('/login?restored=1')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Checking setup status…</p>
      </div>
    )
  }

  if (!needsSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Setup already complete</h1>
          <p className="text-sm text-gray-500 mb-6">This database already has an admin account.</p>
          <a href="/login" className="text-sm font-medium text-blue-600 hover:text-blue-500">
            Go to login →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="h-12 w-12 bg-blue-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-xl">W</span>
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">Welcome to WareCore</h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          This database is empty — create an admin account, or restore your existing data.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="flex border-b border-gray-200 mb-6">
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 ${
                mode === 'create' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Create new admin
            </button>
            <button
              type="button"
              onClick={() => setMode('restore')}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 ${
                mode === 'restore' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Restore from backup
            </button>
          </div>

          {mode === 'restore' ? (
            <form className="space-y-6" onSubmit={handleRestoreSubmit}>
              <div>
                <label htmlFor="backup_file" className="block text-sm font-medium text-gray-700">
                  Backup file
                </label>
                <p className="mt-1 text-xs text-gray-500">
                  Select a backup JSON file exported from the Backup &amp; Restore page of your online WareCore account.
                </p>
                <div className="mt-2">
                  <input
                    id="backup_file"
                    type="file"
                    accept=".json,application/json"
                    required
                    onChange={handleRestoreFileChange}
                    className="block w-full text-sm text-gray-600"
                  />
                </div>
                {restoreFile && (
                  <p className="mt-1 text-xs text-gray-400">
                    {restoreFile.name} — {(restoreFile.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>

              {restoreError && (
                <div className="rounded-md bg-red-50 p-4">
                  <p className="text-sm text-red-700">{restoreError}</p>
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={restoreLoading || !restoreData}
                  className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                >
                  {restoreLoading ? 'Restoring…' : 'Restore from backup'}
                </button>
              </div>
            </form>
          ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                Full name
              </label>
              <div className="mt-1">
                <input
                  id="full_name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email or username
              </label>
              <div className="mt-1">
                <input
                  id="email"
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
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">At least 8 characters</p>
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
                className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? 'Creating account…' : 'Create admin account'}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}
