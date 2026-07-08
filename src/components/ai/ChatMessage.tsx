import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import type { LedgerBlock } from '@/lib/ai/tools'

export type Message = {
  role: 'user' | 'assistant'
  content: string
  ledger?: LedgerBlock
}

const fmtQ = (n: number) => n.toFixed(3)

function LedgerTable({ ledger }: { ledger: LedgerBlock }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-xs">
        <span className="font-medium text-gray-700">{ledger.itemLabel}</span>
        <span className="text-gray-500">
          {ledger.fromDate} → {ledger.toDate}
        </span>
      </div>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-gray-500">
              <th className="px-3 py-1.5">Date</th>
              <th className="px-3 py-1.5">Type</th>
              <th className="px-3 py-1.5">Reference</th>
              <th className="px-3 py-1.5">Warehouse</th>
              <th className="px-3 py-1.5 text-right">In</th>
              <th className="px-3 py-1.5 text-right">Out</th>
              <th className="px-3 py-1.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="bg-blue-50/40 font-medium">
              <td className="px-3 py-1.5 text-gray-600" colSpan={6}>
                Opening Balance
              </td>
              <td className="px-3 py-1.5 text-right text-blue-800">{fmtQ(ledger.openingBalance)}</td>
            </tr>
            {ledger.entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                  No movements in this period.
                </td>
              </tr>
            )}
            {ledger.entries.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{formatDate(row.date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{row.type}</td>
                <td className="px-3 py-1.5 text-gray-500">{row.reference}</td>
                <td className="px-3 py-1.5 text-gray-500">{row.warehouse}</td>
                <td className="px-3 py-1.5 text-right text-green-700">
                  {row.quantity > 0 ? fmtQ(row.quantity) : ''}
                </td>
                <td className="px-3 py-1.5 text-right text-red-600">
                  {row.quantity < 0 ? fmtQ(Math.abs(row.quantity)) : ''}
                </td>
                <td className={`px-3 py-1.5 text-right font-medium ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {fmtQ(row.balance)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 bg-gray-50 font-semibold">
              <td className="px-3 py-1.5 text-gray-700" colSpan={6}>
                Closing Balance
              </td>
              <td className={`px-3 py-1.5 text-right ${ledger.closingBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(ledger.closingBalance)} {ledger.unit}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {ledger.truncated && (
        <div className="border-t bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Showing first 200 entries.{' '}
          <Link
            href={`/reports/item-ledger?item=${ledger.itemId}&from=${ledger.fromDate}&to=${ledger.toDate}`}
            className="font-medium hover:underline"
          >
            View full ledger →
          </Link>
        </div>
      )}
    </div>
  )
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] ${isUser ? '' : 'w-full'}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            isUser ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {message.content}
        </div>
        {message.ledger && <LedgerTable ledger={message.ledger} />}
      </div>
    </div>
  )
}
