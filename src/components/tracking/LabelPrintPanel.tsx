'use client'

import { useEffect, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import type { TrackingPrinter, TrackingUnit } from '@/lib/tracking/constants'
import { downloadZpl, sendToZebra, SEND_FAILURE_MESSAGE } from '@/lib/tracking/browserPrint'
import { errorText, trackingApi } from './api'

interface PrintResponse {
  jobId: string
  jobType: string
  zpl: string
}

type JobState =
  | { step: 'working' }
  | { step: 'confirm'; jobId: string }
  | { step: 'download'; jobId: string; zpl: string; message: string }
  | { step: 'done' }
  | { step: 'failed' }
  | { step: 'error'; message: string }

/** Prints one or more labels, then asks the operator whether each came out correctly. */
export function LabelPrintPanel({ units, reprint = false, onChanged }: {
  units: TrackingUnit[]
  reprint?: boolean
  onChanged?: () => void
}) {
  const warehouseId = units[0]?.warehouse_id
  const [printers, setPrinters] = useState<TrackingPrinter[] | null>(null)
  const [printerId, setPrinterId] = useState('')
  const [reason, setReason] = useState('')
  const [jobs, setJobs] = useState<Record<string, JobState>>({})
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    trackingApi<{ printers: TrackingPrinter[] }>('printers')
      .then(({ printers: all }) => {
        const here = all.filter((printer) => printer.warehouse_id === warehouseId)
        setPrinters(here)
        setPrinterId((current) => current || here[0]?.id || '')
      })
      .catch((err) => setLoadError(errorText(err)))
  }, [warehouseId])

  const setJob = (unitId: string, state: JobState) => setJobs((all) => ({ ...all, [unitId]: state }))

  const printUnit = async (unit: TrackingUnit) => {
    setJob(unit.id, { step: 'working' })
    try {
      const job = await trackingApi<PrintResponse>('print', {
        method: 'POST',
        body: { unit_id: unit.id, printer_id: printerId, reason: reprint ? reason : undefined },
      })
      const sent = await sendToZebra(job.zpl)
      if (sent.ok) {
        await trackingApi(`print/${job.jobId}`, { method: 'PATCH', body: { status: 'sent' } })
        setJob(unit.id, { step: 'confirm', jobId: job.jobId })
      } else {
        setJob(unit.id, { step: 'download', jobId: job.jobId, zpl: job.zpl, message: SEND_FAILURE_MESSAGE[sent.reason] })
      }
    } catch (err) {
      setJob(unit.id, { step: 'error', message: errorText(err) })
    }
    onChanged?.()
  }

  const printAll = async () => {
    for (const unit of units) {
      const state = jobs[unit.id]
      if (!state || state.step === 'error') await printUnit(unit)
    }
  }

  const answer = async (unitId: string, jobId: string, status: 'confirmed' | 'failed') => {
    try {
      await trackingApi(`print/${jobId}`, { method: 'PATCH', body: { status } })
      setJob(unitId, { step: status === 'confirmed' ? 'done' : 'failed' })
    } catch (err) {
      setJob(unitId, { step: 'error', message: errorText(err) })
    }
    onChanged?.()
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (!printers) return <p className="text-sm text-gray-500">Loading printers…</p>
  if (printers.length === 0) {
    // Still list the labels, so staff can see what was created and print later.
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No printer is set up for this warehouse. An admin can add one in QR Tracking Settings.
        </p>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-mono text-gray-800">{unit.stock_tracking_id}</span>
              <span className="text-gray-500">{unit.quantity} {unit.unit}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const canPrint = !!printerId && (!reprint || reason.trim().length > 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          <span className="mb-1 block font-medium">Printer</span>
          <select
            value={printerId}
            onChange={(e) => setPrinterId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
          </select>
        </label>
        {reprint && (
          <label className="min-w-56 flex-1 text-sm text-gray-700">
            <span className="mb-1 block font-medium">Reason for reprint</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example, label damaged"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}
        <button
          type="button"
          disabled={!canPrint}
          onClick={printAll}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          {reprint ? 'Reprint label' : units.length > 1 ? `Print ${units.length} labels` : 'Print label'}
        </button>
      </div>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {units.map((unit) => {
          const job = jobs[unit.id]
          return (
            <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-mono text-gray-800">
                {unit.stock_tracking_id}
                <span className="ml-2 font-sans text-gray-500">{unit.quantity} {unit.unit}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {job?.step === 'working' && <span className="text-gray-500">Sending…</span>}
                {job?.step === 'confirm' && (
                  <>
                    <span className="text-gray-700">Did the label print correctly?</span>
                    <button type="button" onClick={() => answer(unit.id, job.jobId, 'confirmed')} className="rounded border border-green-300 bg-green-50 px-2 py-1 text-green-800">Yes</button>
                    <button type="button" onClick={() => answer(unit.id, job.jobId, 'failed')} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">No</button>
                  </>
                )}
                {job?.step === 'download' && (
                  <>
                    <span className="text-amber-700">{job.message}</span>
                    <button
                      type="button"
                      onClick={() => downloadZpl(job.zpl, `${unit.stock_tracking_id}.zpl`)}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-gray-700"
                    >
                      <Download className="h-3.5 w-3.5" /> Label file
                    </button>
                    <button type="button" onClick={() => answer(unit.id, job.jobId, 'confirmed')} className="rounded border border-green-300 bg-green-50 px-2 py-1 text-green-800">Printed OK</button>
                    <button type="button" onClick={() => answer(unit.id, job.jobId, 'failed')} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800">Not printed</button>
                  </>
                )}
                {job?.step === 'done' && <span className="font-medium text-green-700">Printed and confirmed</span>}
                {job?.step === 'failed' && <span className="font-medium text-red-700">Marked as not printed</span>}
                {job?.step === 'error' && <span className="text-red-600">{job.message}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
