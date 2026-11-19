'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { DISPATCH_STATUS_LABELS, type VendorDispatch } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { DispatchBadge } from './StatusBadge'

export interface JobWorkOptions {
  warehouses: { id: string; name: string; company_id: string; company_name: string }[]
  vendors: { id: string; name: string; used_for_job_work: boolean }[]
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'

/** A vendor list with the vendors already used for job work first. */
export function VendorSelect({ vendors, value, onChange, exclude }: {
  vendors: JobWorkOptions['vendors']
  value: string
  onChange: (id: string) => void
  exclude?: string | null
}) {
  const shown = vendors.filter((v) => v.id !== exclude)
  const used = shown.filter((v) => v.used_for_job_work)
  const others = shown.filter((v) => !v.used_for_job_work)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      <option value="">Choose</option>
      {used.length > 0 && <optgroup label="Job work vendors">{used.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
      {others.length > 0 && <optgroup label="Other suppliers">{others.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>}
    </select>
  )
}

export function Dispatches({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [dispatches, setDispatches] = useState<VendorDispatch[] | null>(null)
  const [options, setOptions] = useState<JobWorkOptions>({ warehouses: [], vendors: [] })
  const [error, setError] = useState('')
  const [form, setForm] = useState({ warehouse_id: '', vendor_id: '', vehicle_number: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      trackingApi<{ dispatches: VendorDispatch[] } & JobWorkOptions>(`dispatches?search=${encodeURIComponent(search)}&status=${status}`)
        .then((data) => {
          setDispatches(data.dispatches)
          setOptions({ warehouses: data.warehouses, vendors: data.vendors })
          setError('')
        })
        .catch((err) => setError(errorText(err)))
    }, 250)
    return () => clearTimeout(timer)
  }, [search, status])

  const create = async () => {
    const warehouse = options.warehouses.find((w) => w.id === form.warehouse_id)
    if (!warehouse) return
    setSaving(true)
    setError('')
    try {
      const { dispatch } = await trackingApi<{ dispatch: VendorDispatch }>('dispatches', {
        method: 'POST',
        body: { ...form, company_id: warehouse.company_id },
      })
      router.push(`/tracking/dispatches/${dispatch.id}`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {canCreate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Send bundles to a job work vendor</h2>
          <p className="text-sm text-gray-600">Start a dispatch, scan each bundle as it is loaded, then mark it sent. The job work order can be linked now or after it has been entered.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">From warehouse</span>
              <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} className={field}>
                <option value="">Choose</option>
                {options.warehouses.map((w) => <option key={w.id} value={w.id}>{w.company_name} · {w.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Vendor</span>
              <VendorSelect vendors={options.vendors} value={form.vendor_id} onChange={(vendor_id) => setForm({ ...form, vendor_id })} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Vehicle number (optional)</span>
              <input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value.toUpperCase() })} className={`${field} font-mono`} />
            </label>
          </div>
          <button type="button" disabled={saving || !form.warehouse_id || !form.vendor_id} onClick={create} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Starting…' : 'Start dispatch'}
          </button>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dispatch, vendor, job work order or vehicle" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">All dispatches</option>
          {Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {dispatches === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {dispatches?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No vendor dispatches found.</p>}
      {!!dispatches?.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Dispatch</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">Bundles</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3">Job work order</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dispatches.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono"><Link href={`/tracking/dispatches/${d.id}`} className="text-blue-600 hover:underline">{d.dispatch_no}</Link></td>
                  <td className="px-4 py-3 text-gray-700">{d.vendor_name}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{d.bundle_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">{d.total_quantity} {d.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{d.job_work_reference ?? 'Not linked'}</td>
                  <td className="px-4 py-3 text-gray-700">{d.warehouse_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(d.created_at)}</td>
                  <td className="px-4 py-3"><DispatchBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
