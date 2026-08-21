'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown } from 'lucide-react'

interface Props {
  title: string
  icon: ReactNode
  iconBg: string
  addHref: string
  href: string
  columns: string[]
  rows: ReactNode[][]
}

export default function CollapsibleSection({ title, icon, iconBg, addHref, href, columns, rows }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden transition-shadow duration-200 hover:shadow-md">
      {/* Header — always visible */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${iconBg}`}>
            {icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-gray-900 text-sm truncate">{title}</h2>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 shrink-0">
                {rows.length}
              </span>
            </div>
            <Link
              href={href}
              className="text-xs text-blue-500 mt-0.5 hover:underline leading-none inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={addHref}
            className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
          >
            + Add
          </Link>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expandable table — uses CSS grid-rows animation for smooth height */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-100">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide text-left whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-5 text-gray-400 text-center text-xs"
                    >
                      Nothing added yet
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {row.map((cell, j) => (
                        <td key={j} className="px-4 py-2.5 text-gray-700 text-sm whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
