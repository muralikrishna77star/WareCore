'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TrackingPrinter } from '@/lib/tracking/constants'
import { downloadZpl } from '@/lib/tracking/browserPrint'
import type { PrintMethod } from '@/lib/tracking/dialogPrint'
import { errorText, trackingApi } from './api'
import { deliverLabels, PrintMethodPicker, usePrintMethod, type LabelJob } from './PrintMethod'

interface Settings {
  companies: { id: string; name: string }[]
  warehouses: { id: string; company_id: string; name: string }[]
  flags: { company_id: string; warehouse_id: string | null; enabled: boolean }[]
  gpsCompanies: string[]
  printers: TrackingPrinter[]
  templates: { name: string; version: string; width_mm: string; height_mm: string; dpi: string }[]
}

const EMPTY_PRINTER = { company_id: '', warehouse_id: '', name: '', model: 'Zebra ZPL printer', dpi: '203', label_width_mm: '100', label_height_mm: '50' }

export function TrackingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [printer, setPrinter] = useState(EMPTY_PRINTER)
  const [testJob, setTestJob] = useState<{ job: LabelJob; sent: boolean } | null>(null)
  const [method, setMethod] = usePrintMethod()

  const load = useCallback(async () => {
    try {
      setSettings(await trackingApi<Settings>('settings'))
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    let current = true
    trackingApi<Settings>('settings')
      .then((data) => { if (current) setSettings(data) })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [])

  const post = async (body: Record<string, unknown>) => {
    setError('')
    setNotice('')
    try {
      const result = await trackingApi<Record<string, unknown>>('settings', { method: 'POST', body })
      await load()
      return result
    } catch (err) {
      setError(errorText(err))
      return null
    }
  }

  const companyFlag = (companyId: string) => settings?.flags.find((f) => f.company_id === companyId && !f.warehouse_id)?.enabled ?? false
  const warehouseFlag = (warehouseId: string) => settings?.flags.find((f) => f.warehouse_id === warehouseId)

  const savePrinter = async () => {
    const saved = await post({ action: 'save_printer', ...printer })
    if (saved) {
      setPrinter(EMPTY_PRINTER)
      setNotice('Printer saved.')
    }
  }

  const sendTest = async (job: LabelJob, via: PrintMethod) => {
    setError('')
    setNotice('')
    const [result] = await deliverLabels(via, [job], 'Test label')
    try {
      if (result.ok) {
        await trackingApi(`print/${job.jobId}`, { method: 'PATCH', body: { status: 'sent' } })
        setNotice('Test label sent. Check the printer, then confirm the result.')
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(errorText(err))
    }
    setTestJob({ job, sent: result.ok })
  }

  const testPrint = async (printerId: string) => {
    const job = await post({ action: 'test_print', printer_id: printerId }) as LabelJob | null
    if (job) await sendTest(job, method)
  }

  const answerTest = async (status: 'confirmed' | 'failed') => {
    if (!testJob) return
    try {
      await trackingApi(`print/${testJob.job.jobId}`, { method: 'PATCH', body: { status } })
      setNotice(status === 'confirmed' ? 'Test print confirmed.' : 'Test print marked as failed.')
      setTestJob(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  if (!settings) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const printerWarehouses = settings.warehouses.filter((w) => w.company_id === printer.company_id)
  const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Companies and warehouses</h2>
        <p className="text-sm text-gray-600">Only purchase lines added after tracking is switched on can be labelled.</p>
        <ul className="divide-y divide-gray-100">
          {settings.companies.map((company) => {
            const on = companyFlag(company.id)
            const warehouses = settings.warehouses.filter((w) => w.company_id === company.id)
            return (
              <li key={company.id} className="space-y-2 py-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-gray-900">
                  {company.name}
                  <span className="flex items-center gap-2 font-normal text-gray-600">
                    {on ? 'On' : 'Off'}
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => post({ action: 'set_flag', company_id: company.id, warehouse_id: null, enabled: e.target.checked })}
                      className="h-4 w-4"
                    />
                  </span>
                </label>
                {warehouses.map((warehouse) => {
                  const flag = warehouseFlag(warehouse.id)
                  return (
                    <label key={warehouse.id} className="ml-4 flex items-center justify-between gap-3 text-sm text-gray-700">
                      {warehouse.name}
                      <select
                        value={flag ? (flag.enabled ? 'on' : 'off') : 'follow'}
                        onChange={(e) => post({
                          action: 'set_flag', company_id: company.id, warehouse_id: warehouse.id,
                          enabled: e.target.value === 'follow' ? null : e.target.value === 'on',
                        })}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="follow">Same as company</option>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </label>
                  )
                })}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">GPS on scans</h2>
        <p className="text-sm text-gray-600">
          Off by default. When on, the device position is saved only at the moment of a put-away, move or handover scan, and is deleted after 90 days.
          Each user&apos;s device asks for permission, and a scan still works if they refuse.
        </p>
        <ul className="divide-y divide-gray-100">
          {settings.companies.map((company) => {
            const on = settings.gpsCompanies.includes(company.id)
            return (
              <li key={company.id} className="py-2">
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-gray-900">
                  {company.name}
                  <span className="flex items-center gap-2 font-normal text-gray-600">
                    {on ? 'On' : 'Off'}
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => post({ action: 'set_gps', company_id: company.id, enabled: e.target.checked })}
                      className="h-4 w-4"
                    />
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Printers</h2>
        <p className="text-sm text-gray-600">
          A printer here records the label size used at a warehouse. Labels can reach the printer two ways, chosen on each computer:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            <span className="font-medium text-gray-800">Print dialog (any printer).</span> Works with any label or office printer
            installed on the computer, by USB or network. Install the printer&apos;s own driver and set its paper size to the label
            size below. For a Zebra, use the ZDesigner driver and set the label size under Printing Preferences.
          </li>
          <li>
            <span className="font-medium text-gray-800">Zebra Browser Print (direct).</span> For Zebra printers only. Install Zebra
            Browser Print on the computer the printer is connected to and pick the printer as its default. Then open{' '}
            <span className="font-mono">https://127.0.0.1:9101/ssl_support</span> once and accept the certificate.
          </li>
        </ul>
        <PrintMethodPicker method={method} onChange={setMethod} showHint={false} />
        {settings.printers.length === 0 && <p className="text-sm text-gray-600">No printers yet.</p>}
        <ul className="divide-y divide-gray-100">
          {settings.printers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium text-gray-900">{p.name}</span>
                <span className="ml-2 text-gray-600">{p.warehouse_name} · {p.model} · {p.dpi} dpi · {Number(p.label_width_mm)} × {Number(p.label_height_mm)} mm</span>
              </span>
              <button type="button" onClick={() => testPrint(p.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">Test print</button>
            </li>
          ))}
        </ul>

        {testJob && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
            <span className="text-gray-700">Did the test label print correctly?</span>
            <button type="button" onClick={() => answerTest('confirmed')} className="rounded border border-green-300 bg-green-50 px-2 py-1 text-green-800">Yes</button>
            <button type="button" onClick={() => answerTest('failed')} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">No</button>
            {!testJob.sent && method === 'zebra' && (
              <button type="button" onClick={() => sendTest(testJob.job, 'dialog')} className="rounded border border-gray-300 px-2 py-1 text-gray-700">Use print dialog</button>
            )}
            {!testJob.sent && (
              <button type="button" onClick={() => downloadZpl(testJob.job.zpl, 'test-label.zpl')} className="rounded border border-gray-300 px-2 py-1 text-gray-700">Download Zebra label file</button>
            )}
          </div>
        )}

        <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Company</span>
            <select value={printer.company_id} onChange={(e) => setPrinter({ ...printer, company_id: e.target.value, warehouse_id: '' })} className={field}>
              <option value="">Choose</option>
              {settings.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Warehouse</span>
            <select value={printer.warehouse_id} onChange={(e) => setPrinter({ ...printer, warehouse_id: e.target.value })} className={field}>
              <option value="">Choose</option>
              {printerWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Printer name</span>
            <input value={printer.name} onChange={(e) => setPrinter({ ...printer, name: e.target.value })} className={field} />
          </label>
          <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Model</span>
            <input value={printer.model} onChange={(e) => setPrinter({ ...printer, model: e.target.value })} className={field} />
          </label>
          <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Resolution</span>
            <select value={printer.dpi} onChange={(e) => setPrinter({ ...printer, dpi: e.target.value })} className={field}>
              <option value="203">203 dpi</option><option value="300">300 dpi</option><option value="600">600 dpi</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Width (mm)</span>
              <input inputMode="decimal" value={printer.label_width_mm} onChange={(e) => setPrinter({ ...printer, label_width_mm: e.target.value })} className={field} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Height (mm)</span>
              <input inputMode="decimal" value={printer.label_height_mm} onChange={(e) => setPrinter({ ...printer, label_height_mm: e.target.value })} className={field} />
            </label>
          </div>
        </div>
        <button type="button" onClick={savePrinter} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Add printer</button>
      </section>
    </div>
  )
}
