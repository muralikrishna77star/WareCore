'use client'

import { useSyncExternalStore } from 'react'
import type { PrintableLabel } from '@/lib/tracking/htmlLabel'
import { sendToZebra, SEND_FAILURE_MESSAGE } from '@/lib/tracking/browserPrint'
import {
  PRINT_METHOD_LABELS, printLabelsWithDialog, savedPrintMethod, savePrintMethod, type PrintMethod,
} from '@/lib/tracking/dialogPrint'

/** What the server returns for one requested label. */
export interface LabelJob {
  jobId: string
  zpl: string
  label: PrintableLabel
}

export type DeliveryResult = { ok: true } | { ok: false; message: string }

/** Sends the labels the chosen way. Dialog labels go in one dialog; Zebra labels one by one. */
export async function deliverLabels(method: PrintMethod, jobs: LabelJob[], title?: string): Promise<DeliveryResult[]> {
  if (method === 'dialog') {
    try {
      await printLabelsWithDialog(jobs.map((job) => job.label), title)
      return jobs.map(() => ({ ok: true }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The print dialog could not open'
      return jobs.map(() => ({ ok: false, message }))
    }
  }
  const results: DeliveryResult[] = []
  for (const job of jobs) {
    const sent = await sendToZebra(job.zpl)
    results.push(sent.ok ? { ok: true } : { ok: false, message: SEND_FAILURE_MESSAGE[sent.reason] })
  }
  return results
}

// Every picker on the page follows the same saved choice.
const listeners = new Set<() => void>()
let chosenThisPage: PrintMethod | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** This computer's print method. The server render always shows the print dialog. */
export function usePrintMethod(): [PrintMethod, (method: PrintMethod) => void] {
  const method = useSyncExternalStore(subscribe, () => chosenThisPage ?? savedPrintMethod(), () => 'dialog' as PrintMethod)
  const choose = (next: PrintMethod) => {
    savePrintMethod(next)
    chosenThisPage = next
    for (const listener of listeners) listener()
  }
  return [method, choose]
}

const HINT: Record<PrintMethod, string> = {
  dialog: 'Works with any printer on this computer, or Save as PDF. In the dialog, choose the label printer, set Margins to None and Scale to 100%.',
  zebra: 'Sends the label straight to a Zebra printer. Needs Zebra Browser Print running on this computer, with the printer as its default.',
}

export function PrintMethodPicker({ method, onChange, showHint = true }: {
  method: PrintMethod
  onChange: (method: PrintMethod) => void
  showHint?: boolean
}) {
  return (
    <div className="text-sm text-gray-700">
      <label>
        <span className="mb-1 block font-medium">Print using</span>
        <select
          value={method}
          onChange={(e) => onChange(e.target.value as PrintMethod)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {(Object.keys(PRINT_METHOD_LABELS) as PrintMethod[]).map((key) => (
            <option key={key} value={key}>{PRINT_METHOD_LABELS[key]}</option>
          ))}
        </select>
      </label>
      {showHint && <p className="mt-1 max-w-md text-xs text-gray-500">{HINT[method]}</p>}
    </div>
  )
}
