'use client'

import { useCallback, useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { LOCATION_TYPE_LABELS, type LocationType, type TrackingLocation, type TrackingPrinter } from '@/lib/tracking/constants'
import { downloadZpl } from '@/lib/tracking/browserPrint'
import type { PrintMethod } from '@/lib/tracking/dialogPrint'
import { errorText, trackingApi } from './api'
import { deliverLabels, PrintMethodPicker, usePrintMethod, type LabelJob } from './PrintMethod'

interface Warehouse {
  id: string
  name: string
  company_id: string
  company_name: string
}

interface PrintState {
  location: TrackingLocation
  job?: LabelJob
  /** Set when the label could not be sent. */
  message?: string
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'

export function Locations({ canManage }: { canManage: boolean }) {
  const [locations, setLocations] = useState<TrackingLocation[] | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [printers, setPrinters] = useState<TrackingPrinter[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState({ warehouse_id: '', code: '', name: '', location_type: 'STORAGE' as LocationType })
  const [printing, setPrinting] = useState<PrintState | null>(null)
  const [printerId, setPrinterId] = useState('')
  const [method, setMethod] = usePrintMethod()

  const fetchAll = useCallback(() => trackingApi<{ locations: TrackingLocation[]; warehouses: Warehouse[] }>('locations'), [])

  const load = useCallback(async () => {
    try {
      const data = await fetchAll()
      setLocations(data.locations)
      setWarehouses(data.warehouses)
    } catch (err) {
      setError(errorText(err))
    }
  }, [fetchAll])

  useEffect(() => {
    let current = true
    fetchAll()
      .then((data) => { if (current) { setLocations(data.locations); setWarehouses(data.warehouses) } })
      .catch((err) => { if (current) setError(errorText(err)) })
    trackingApi<{ printers: TrackingPrinter[] }>('printers')
      .then((data) => { if (current) setPrinters(data.printers.filter((p) => p.is_active)) })
      .catch(() => { /* Printing is unavailable, but the list still works. */ })
    return () => { current = false }
  }, [fetchAll])

  const add = async () => {
    const warehouse = warehouses.find((w) => w.id === form.warehouse_id)
    if (!warehouse) return
    setError('')
    try {
      await trackingApi('locations', { method: 'POST', body: { ...form, company_id: warehouse.company_id } })
      setForm({ ...form, code: '', name: '' })
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const setActive = async (location: TrackingLocation, active: boolean) => {
    setError('')
    try {
      await trackingApi(`locations/${location.id}`, { method: 'PATCH', body: { is_active: active } })
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const startPrint = (location: TrackingLocation) => {
    setPrinting({ location })
    setPrinterId(printers.find((p) => p.warehouse_id === location.warehouse_id)?.id ?? '')
  }

  const send = async (location: TrackingLocation, job: LabelJob, via: PrintMethod) => {
    const [result] = await deliverLabels(via, [job], `Location ${location.code}`)
    if (result.ok) {
      await trackingApi(`print/${job.jobId}`, { method: 'PATCH', body: { status: 'sent' } })
      setPrinting({ location, job })
    } else {
      setPrinting({ location, job, message: result.message })
    }
  }

  const print = async () => {
    if (!printing) return
    setError('')
    try {
      const job = await trackingApi<LabelJob>(`locations/${printing.location.id}`, { method: 'POST', body: { printer_id: printerId } })
      await send(printing.location, job, method)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const retryWithDialog = async () => {
    if (!printing?.job) return
    setError('')
    try {
      await send(printing.location, printing.job, 'dialog')
    } catch (err) {
      setError(errorText(err))
    }
  }

  const answer = async (status: 'confirmed' | 'failed') => {
    if (!printing?.job) return
    try {
      await trackingApi(`print/${printing.job.jobId}`, { method: 'PATCH', body: { status } })
      setPrinting(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const warehousePrinters = printers.filter((p) => p.warehouse_id === printing?.location.warehouse_id)

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {canManage && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Add a location</h2>
          {warehouses.length === 0 && <p className="text-sm text-gray-600">Switch QR tracking on for a warehouse before adding locations.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Warehouse</span>
              <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })} className={field}>
                <option value="">Choose</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.company_name} · {w.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Code</span>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="A-03-2" className={`${field} font-mono`} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Name (optional)</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Type</span>
              <select value={form.location_type} onChange={(e) => setForm({ ...form, location_type: e.target.value as LocationType })} className={field}>
                {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <button type="button" disabled={!form.warehouse_id || !form.code.trim()} onClick={add} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Add location</button>
        </section>
      )}

      {printing && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Print label for {printing.location.code}</h2>
          {warehousePrinters.length === 0 && <p className="text-sm text-amber-800">No printer is set up for this warehouse.</p>}
          {!printing.job && warehousePrinters.length > 0 && (
            <div className="flex flex-wrap items-start gap-3">
              <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Printer</span>
                <select value={printerId} onChange={(e) => setPrinterId(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  {warehousePrinters.map((p) => <option key={p.id} value={p.id}>{p.name} ({Number(p.label_width_mm)} × {Number(p.label_height_mm)} mm)</option>)}
                </select>
              </label>
              <PrintMethodPicker method={method} onChange={setMethod} />
              <button type="button" disabled={!printerId} onClick={print} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Print label</button>
            </div>
          )}
          {printing.job && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {printing.message && <span className="text-amber-700">{printing.message}</span>}
              {printing.message && method === 'zebra' && <button type="button" onClick={retryWithDialog} className="rounded border border-gray-300 px-2 py-1 text-gray-700">Use print dialog</button>}
              {printing.message && <button type="button" onClick={() => downloadZpl(printing.job?.zpl ?? '', `${printing.location.code}.zpl`)} className="rounded border border-gray-300 px-2 py-1 text-gray-700">Zebra label file</button>}
              <span className="text-gray-700">Did the label print correctly?</span>
              <button type="button" onClick={() => answer('confirmed')} className="rounded border border-green-300 bg-green-50 px-2 py-1 text-green-800">Yes</button>
              <button type="button" onClick={() => answer('failed')} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">No</button>
            </div>
          )}
          <button type="button" onClick={() => setPrinting(null)} className="text-sm text-gray-600 hover:underline">Close</button>
        </section>
      )}

      {locations === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {locations?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No locations yet.</p>}
      {!!locations?.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 text-right">Bundles</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {locations.map((location) => (
                <tr key={location.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-gray-900">{location.code}</td>
                  <td className="px-4 py-3 text-gray-700">{location.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{LOCATION_TYPE_LABELS[location.location_type]}</td>
                  <td className="px-4 py-3 text-gray-700">{location.warehouse_name}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{location.bundle_count}</td>
                  <td className="px-4 py-3 text-gray-700">{location.is_active ? 'Active' : 'Inactive'}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button type="button" onClick={() => startPrint(location)} className="mr-2 inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50">
                        <Printer className="h-3.5 w-3.5" /> Label
                      </button>
                      <button type="button" onClick={() => setActive(location, !location.is_active)} className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50">
                        {location.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
