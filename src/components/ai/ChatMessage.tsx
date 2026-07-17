'use client'

import { useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, RefreshCw } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { LedgerBlock } from '@/lib/ai/tools'

export type Message = {
  /** Local id until the message is persisted, then the real ai_messages.id (needed for regenerate targeting). */
  id: string
  role: 'user' | 'assistant'
  content: string
  ledger?: LedgerBlock
  /** True while an assistant reply is still streaming in. */
  pending?: boolean
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

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-700">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children, className }) => {
            const isBlock = /language-/.test(className ?? '')
            return isBlock ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs">{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-lg bg-gray-900 p-3 font-mono text-xs text-gray-100">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1 text-left font-medium text-gray-600">{children}</th>,
          td: ({ children }) => <td className="border-t px-2 py-1">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function ChatMessage({
  message,
  isLastAssistant = false,
  onRegenerate,
}: {
  message: Message
  isLastAssistant?: boolean
  onRegenerate?: () => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] ${isUser ? '' : 'w-full'}`}>
        <div
          className={`rounded-2xl px-3 py-2 ${
            isUser ? 'whitespace-pre-wrap bg-blue-600 text-sm text-white' : 'bg-gray-100 text-gray-800'
          }`}
        >
          {isUser ? (
            message.content
          ) : message.pending && !message.content ? (
            <span className="text-sm text-gray-500">Thinking…</span>
          ) : (
            <AssistantMarkdown content={message.content} />
          )}
        </div>
        {message.ledger && <LedgerTable ledger={message.ledger} />}
        {!isUser && !message.pending && (
          <div className="mt-1 flex items-center gap-1 pl-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy"
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {isLastAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                title="Regenerate"
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
