'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '../../StatusBadge'
import { formatDateTime } from '@/lib/dates'

interface Customer {
  id: string
  slug: string
  display_name: string
  db_name: string
  status: string
  brand_color: string | null
  has_logo: boolean
  google_sign_in: boolean
  provision_error: string | null
  created_at: string
  created_by: string | null
  version: string
  hosts: string[]
}
interface Event { action: string; detail: string | null; owner_email: string | null; created_at: string }

type Loaded = { customer: Customer; events: Event[] } | { error: string }

async function fetchCustomer(slug: string): Promise<Loaded> {
  const res = await fetch(`/api/owner/customers/${slug}`)
  const data = await res.json().catch(() => ({}))
  return res.ok ? data : { error: data.error ?? `Could not load (${res.status})` }
}

const card = 'rounded-lg bg-white p-6 shadow'
const input = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2'
const primary = 'rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60'
const secondary = 'rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60'

export default function CustomerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [google, setGoogle] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [admin, setAdmin] = useState({ fullName: '', email: '', password: '' })

  const apply = useCallback((r: Loaded) => {
    if ('error' in r) { setLoadError(r.error); return }
    setCustomer(r.customer)
    setEvents(r.events)
    setName(r.customer.display_name)
    setColor(r.customer.brand_color ?? '#2563eb')
    setGoogle(r.customer.google_sign_in)
  }, [])
  const load = useCallback(() => fetchCustomer(slug).then(apply), [slug, apply])

  useEffect(() => {
    let current = true
    fetchCustomer(slug).then((r) => { if (current) apply(r) })
    return () => { current = false }
  }, [slug, apply])

  async function call(url: string, init: RequestInit, okText: string) {
    setBusy(true)
    setMessage(null)
    const res = await fetch(url, init)
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setMessage(res.ok ? { ok: true, text: okText } : { ok: false, text: data.error ?? `Failed (${res.status})` })
    await load()
    return res.ok
  }

  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  if (loadError) return <p className="text-red-600">{loadError}</p>
  if (!customer) return <p className="text-gray-600">Loading…</p>

  const primaryHost = customer.hosts[0]
  return (
    <div className="space-y-6">
      <div>
        <Link href="/owner" className="text-sm text-blue-700 hover:underline">← Customers</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{customer.display_name}</h1>
          <StatusBadge status={customer.status} />
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {customer.hosts.map((h) => <span key={h} className="mr-3 font-mono">{h}</span>)}
          · database <span className="font-mono">{customer.db_name}</span>
        </p>
      </div>

      {message && (
        <p className={`rounded-md p-3 text-sm ${message.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`} role="status">{message.text}</p>
      )}

      {(customer.status === 'failed' || customer.status === 'provisioning') && (
        <section className={card}>
          <h2 className="font-semibold text-gray-900">Finish set-up</h2>
          {customer.provision_error && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-800">{customer.provision_error}</pre>}
          <p className="mt-2 text-sm text-gray-600">Runs set-up again; steps already done are skipped. Enter the first admin again: passwords are never kept.</p>
          <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); call(`/api/owner/customers/${slug}/setup`, json('POST', { admin }), 'Set-up finished.') }}>
            <input className={input} placeholder="Full name" value={admin.fullName} onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} required />
            <input className={input} placeholder="Email or username" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required />
            <input className={input} type="password" minLength={10} placeholder="Password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required />
            <div className="sm:col-span-3"><button className={primary} disabled={busy}>{busy ? 'Setting up…' : 'Run set-up again'}</button></div>
          </form>
        </section>
      )}

      <section className={card}>
        <h2 className="font-semibold text-gray-900">Name and colour</h2>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); call(`/api/owner/customers/${slug}`, json('PATCH', { displayName: name, brandColor: color }), 'Saved. Open screens show it within 30 seconds.') }}>
          <label className="block text-sm font-medium text-gray-700">
            Customer name
            <input className={input} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Main colour
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 rounded border border-gray-300" />
              <span className="font-mono text-sm text-gray-600">{color}</span>
              <span className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ background: color }}>Button preview</span>
            </div>
          </label>
          <button className={primary} disabled={busy}>Save</button>
        </form>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-gray-900">Logo</h2>
        <p className="mt-1 text-sm text-gray-600">PNG, JPEG or WebP, up to 256 KB. Shown on the sign-in page and at the top of the menu. A wide logo works best at about 400 × 120 pixels.</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-40 items-center justify-center rounded border border-gray-200 bg-gray-900 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-only preview of an uploaded image */}
            <img alt="" className="max-h-12 max-w-full object-contain"
              src={customer.has_logo ? `/api/owner/customers/${slug}/logo?v=${customer.version}` : '/assets/brand/logo-mark.svg'} />
          </div>
          <label className={`${secondary} cursor-pointer`}>
            Upload logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const form = new FormData()
              form.append('logo', f)
              call(`/api/owner/customers/${slug}/logo`, { method: 'POST', body: form }, 'Logo saved.')
              e.target.value = ''
            }} />
          </label>
          {customer.has_logo && (
            <button className={secondary} disabled={busy} onClick={() => call(`/api/owner/customers/${slug}/logo`, { method: 'DELETE' }, 'Logo removed.')}>Remove logo</button>
          )}
        </div>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-gray-900">Google sign-in</h2>
        <p className="mt-1 text-sm text-gray-600">
          Before switching this on, add <span className="font-mono">https://{primaryHost}/api/auth/google/callback</span> as an authorised redirect URI in Google Cloud Console.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={google} onChange={(e) => {
            setGoogle(e.target.checked)
            call(`/api/owner/customers/${slug}`, json('PATCH', { googleSignIn: e.target.checked }), e.target.checked ? 'Google sign-in on.' : 'Google sign-in off.')
          }} />
          Offer &quot;Sign in with Google&quot; on this customer&apos;s sign-in page
        </label>
      </section>

      {(customer.status === 'active' || customer.status === 'suspended') && (
        <section className={card}>
          <h2 className="font-semibold text-gray-900">{customer.status === 'active' ? 'Switch off' : 'Switch back on'}</h2>
          {customer.status === 'active' ? (
            <>
              <p className="mt-1 text-sm text-gray-600">Nobody can open {primaryHost} while it&apos;s off. Their data is kept and nothing is deleted.</p>
              {!confirmOff ? (
                <button className={`${secondary} mt-3`} onClick={() => setConfirmOff(true)}>Switch off…</button>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-red-700">Switch off {customer.display_name} now?</span>
                  <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700" disabled={busy}
                    onClick={async () => { await call(`/api/owner/customers/${slug}`, json('PATCH', { status: 'suspended' }), 'Switched off.'); setConfirmOff(false) }}>
                    Yes, switch off
                  </button>
                  <button className={secondary} onClick={() => setConfirmOff(false)}>Cancel</button>
                </div>
              )}
            </>
          ) : (
            <button className={`${primary} mt-3`} disabled={busy} onClick={() => call(`/api/owner/customers/${slug}`, json('PATCH', { status: 'active' }), 'Switched back on.')}>Switch back on</button>
          )}
        </section>
      )}

      <section className={card}>
        <h2 className="font-semibold text-gray-900">History</h2>
        <ul className="mt-3 divide-y divide-gray-100 text-sm">
          {events.map((ev, i) => (
            <li key={i} className="py-2">
              <span className="font-medium text-gray-900">{ev.action.replace(/_/g, ' ')}</span>
              {ev.detail && <span className="text-gray-600"> · {ev.detail}</span>}
              <span className="block text-xs text-gray-500">{formatDateTime(ev.created_at)}{ev.owner_email ? ` · ${ev.owner_email}` : ''}</span>
            </li>
          ))}
          {!events.length && <li className="py-2 text-gray-500">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  )
}
