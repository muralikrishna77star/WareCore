'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DomainNote, type DomainResult } from '../DomainNote'

const suggestSlug = (name: string) =>
  name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '').slice(0, 30)

interface Done { host: string; slug: string; migrationsApplied: number; adminCreated: boolean; domain: DomainResult }

export default function NewCustomerPage() {
  const [rootDomain, setRootDomain] = useState('warecore.space')
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [brandColor, setBrandColor] = useState('#2563eb')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)

  useEffect(() => {
    fetch('/api/owner/customers').then((r) => r.json()).then((d) => d.rootDomain && setRootDomain(d.rootDomain)).catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/owner/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName, slug, brandColor,
        admin: { fullName: adminName, email: adminEmail, password: adminPassword },
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setDone(data)
    else setError(data.error ?? `Set-up failed (${res.status})`)
  }

  if (done) {
    return (
      <div className="max-w-2xl rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-bold text-gray-900">{displayName} is ready</h1>
        <ul className="mt-4 space-y-1 text-sm text-gray-700">
          <li>Database created with {done.migrationsApplied} migrations.</li>
          <li>{done.adminCreated ? `First admin ${adminEmail.toLowerCase().trim()} can sign in.` : 'The database already had users, so no admin was added.'}</li>
          <li>Address: <span className="font-mono">https://{done.host}</span></li>
        </ul>
        <DomainNote domain={done.domain} host={done.host} />
        <div className="mt-6 flex gap-3">
          <Link href={`/owner/customers/${done.slug}`} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Add logo and details</Link>
          <Link href="/owner" className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Back to customers</Link>
        </div>
      </div>
    )
  }

  const input = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2'
  return (
    <div className="max-w-2xl">
      <Link href="/owner" className="text-sm text-blue-700 hover:underline">← Customers</Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Add customer</h1>
      <p className="mt-1 text-sm text-gray-600">Creates an empty WareCore for the customer at their own address. The customer adds their companies, warehouses and users after signing in.</p>

      <form onSubmit={submit} className="mt-6 space-y-6 rounded-lg bg-white p-6 shadow">
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-gray-900">Customer</legend>
          <label className="block text-sm font-medium text-gray-700">
            Customer name (shown on their screens)
            <input className={input} value={displayName} required maxLength={80} placeholder="BSM"
              onChange={(e) => { setDisplayName(e.target.value); if (!slugEdited) setSlug(suggestSlug(e.target.value)) }} />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Address
            <div className="mt-1 flex items-center rounded-md border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500">
              <span className="pl-3 text-gray-500">https://</span>
              <input className="w-full min-w-0 border-0 px-1 py-2 font-mono focus:outline-none focus:ring-0" value={slug} required
                pattern="[a-z][a-z0-9\-]{1,29}" title="2–30 lower-case letters, digits or hyphens, starting with a letter"
                onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true) }} />
              <span className="pr-3 font-mono text-gray-500">.{rootDomain}</span>
            </div>
            <span className="mt-1 block text-xs text-gray-500">Can&apos;t be changed later without moving the customer&apos;s address.</span>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Main colour
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-14 rounded border border-gray-300" />
              <span className="font-mono text-sm text-gray-600">{brandColor}</span>
            </div>
          </label>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-gray-900">First admin</legend>
          <p className="text-xs text-gray-500">The customer&apos;s own admin. Give them these details; they can change the password after signing in.</p>
          <label className="block text-sm font-medium text-gray-700">
            Full name
            <input className={input} value={adminName} onChange={(e) => setAdminName(e.target.value)} required />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Email or username
            <input className={input} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required autoComplete="off" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Password (at least 10 characters)
            <input className={input} type="password" minLength={10} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required autoComplete="new-password" />
          </label>
        </fieldset>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? 'Setting up…' : 'Create customer'}
          </button>
          {busy && <span className="text-sm text-gray-600">Creating the database and running every migration. This can take a minute or two; keep this page open.</span>}
        </div>
      </form>
    </div>
  )
}
