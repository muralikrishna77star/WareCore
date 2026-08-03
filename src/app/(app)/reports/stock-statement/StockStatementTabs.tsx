'use client'

import { useState } from 'react'
import StockStatementTable, { type StatementRow, type StatementTotals } from './StockStatementTable'
import TransactionDetailsTable from './TransactionDetailsTable'
import type { TransactionDetailRow } from '@/lib/exportStockStatementExcel'

export default function StockStatementTabs({
  tableRows,
  totals,
  transactions,
  reconciled,
}: {
  tableRows: StatementRow[]
  totals: StatementTotals
  transactions: TransactionDetailRow[]
  reconciled: boolean
}) {
  const [tab, setTab] = useState<'summary' | 'details'>('summary')
  const [focusItemKey, setFocusItemKey] = useState<string | null>(null)
  const [focusItemLabel, setFocusItemLabel] = useState<string | null>(null)

  const viewTransactionsFor = (key: string, label: string) => {
    setFocusItemKey(key)
    setFocusItemLabel(label)
    setTab('details')
  }

  return (
    <div>
      <div className="px-6 pt-3 border-b flex items-center gap-1 print:hidden">
        <button
          type="button"
          onClick={() => setTab('summary')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            tab === 'summary' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Stock Summary
        </button>
        <button
          type="button"
          onClick={() => setTab('details')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            tab === 'details' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          Transaction Details
          <span className="ml-1.5 text-xs text-gray-400">({transactions.filter((t) => !t.isOpeningRow).length})</span>
        </button>
      </div>

      <div className="overflow-auto max-h-[70vh]">
        {tab === 'summary' ? (
          <StockStatementTable rows={tableRows} totals={totals} onViewTransactions={viewTransactionsFor} />
        ) : (
          <TransactionDetailsTable
            transactions={transactions}
            reconciled={reconciled}
            focusItemKey={focusItemKey}
            focusItemLabel={focusItemLabel}
            onClearFocus={() => { setFocusItemKey(null); setFocusItemLabel(null) }}
          />
        )}
      </div>
    </div>
  )
}
