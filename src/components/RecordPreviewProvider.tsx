'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { ReferenceType } from '@/lib/reference'
import { REFERENCE_LABEL } from '@/lib/reference'

type PreviewState =
  | { mode: 'record'; type: ReferenceType; id: string }
  | { mode: 'list'; category: string }
  | null

type Ctx = {
  openRecord: (type: ReferenceType, id: string) => void
  openList: (category: string) => void
}

const RecordPreviewContext = createContext<Ctx | null>(null)

export function useRecordPreview(): Ctx {
  const ctx = useContext(RecordPreviewContext)
  if (!ctx) throw new Error('useRecordPreview must be used within RecordPreviewProvider')
  return ctx
}

export function RecordPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState>(null)

  return (
    <RecordPreviewContext.Provider
      value={{
        openRecord: (type, id) => setState({ mode: 'record', type, id }),
        openList: (category) => setState({ mode: 'list', category }),
      }}
    >
      {children}
      {state && (
        <PreviewDialog
          state={state}
          onClose={() => setState(null)}
          onOpenRecord={(type, id) => setState({ mode: 'record', type, id })}
        />
      )}
    </RecordPreviewContext.Provider>
  )
}

type RecordData = {
  type: ReferenceType
  title: string
  status?: string
  fields: { label: string; value: string }[]
  items: { name: string; size?: string; quantity: string; unit?: string; rate?: string; amount?: string }[]
  totalQuantity?: string
  totalAmount?: string
  fullUrl: string
}

type ListRow = { id: string; type: ReferenceType | null; label: string; date: string; party: string; amount: string; status: string }
type ListData = { title: string; rows: ListRow[]; viewAllUrl: string }

function PreviewDialog({
  state,
  onClose,
  onOpenRecord,
}: {
  state: NonNullable<PreviewState>
  onClose: () => void
  onOpenRecord: (type: ReferenceType, id: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [record, setRecord] = useState<RecordData | null>(null)
  const [list, setList] = useState<ListData | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setRecord(null)
    setList(null)

    const url =
      state.mode === 'record'
        ? `/api/preview?type=${state.type}&id=${state.id}`
        : `/api/preview/list?category=${state.category}`

    fetch(url)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(data.error || `Server error (${res.status})`)
          return
        }
        if (state.mode === 'record') setRecord(data)
        else setList(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Network error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            {state.mode === 'record' ? record?.title || REFERENCE_LABEL[state.type] : list?.title || 'Records'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-gray-500">Loading…</p>}
          {error && <p className="py-8 text-center text-sm text-red-600">{error}</p>}

          {!loading && !error && state.mode === 'record' && record && (
            <div className="space-y-4">
              {record.status && (
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    record.status === 'cancelled'
                      ? 'bg-red-100 text-red-700'
                      : record.status === 'draft'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                </span>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {record.fields.map((f) => (
                  <div key={f.label}>
                    <p className="text-xs text-gray-500">{f.label}</p>
                    <p className="font-medium text-gray-900">{f.value}</p>
                  </div>
                ))}
              </div>
              {record.items.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Item</th>
                        <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Size</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Qty</th>
                        {record.items.some((i) => i.amount) && (
                          <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Amount</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {record.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 text-gray-700">{item.name}</td>
                          <td className="px-3 py-2 text-gray-500">{item.size || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                          {record.items.some((i) => i.amount) && (
                            <td className="px-3 py-2 text-right text-gray-700">{item.amount || '—'}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(record.totalQuantity || record.totalAmount) && (
                <div className="flex justify-end gap-6 text-sm">
                  {record.totalQuantity && (
                    <p>
                      <span className="text-gray-500">Total Qty: </span>
                      <span className="font-semibold text-gray-900">{record.totalQuantity}</span>
                    </p>
                  )}
                  {record.totalAmount && (
                    <p>
                      <span className="text-gray-500">Total Amount: </span>
                      <span className="font-semibold text-gray-900">{record.totalAmount}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="flex justify-end border-t pt-3">
                <Link href={record.fullUrl} className="text-sm font-medium text-blue-600 hover:underline">
                  Open Full Page ↗
                </Link>
              </div>
            </div>
          )}

          {!loading && !error && state.mode === 'list' && list && (
            <div className="space-y-3">
              {list.rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No records found.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Reference</th>
                        <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Date</th>
                        <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Party / Location</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Amount / Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {list.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            {row.type ? (
                              <button
                                type="button"
                                onClick={() => onOpenRecord(row.type as ReferenceType, row.id)}
                                className="font-medium text-blue-600 hover:underline"
                              >
                                {row.label}
                              </button>
                            ) : (
                              <span className="font-medium text-gray-700">{row.label}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.date || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{row.party}</td>
                          <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{row.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end border-t pt-3">
                <Link href={list.viewAllUrl} className="text-sm font-medium text-blue-600 hover:underline">
                  View All →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
