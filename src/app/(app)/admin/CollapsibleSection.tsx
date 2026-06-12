'use client'

import Link from 'next/link'

interface Props {
  title: string
  icon: string
  addHref: string
  href: string
  columns: string[]
  rows: string[][]
}

export default function CollapsibleSection({ title, icon, addHref, href, columns, rows }: Props) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white overflow-hidden transition-shadow duration-200 hover:shadow-md">
      {/* Header — always visible */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl leading-none shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-gray-900 text-sm truncate">{title}</h2>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 shrink-0">
                {rows.length}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 group-hover:hidden leading-none">
              Hover to expand
            </p>
            <Link
              href={href}
              className="text-xs text-blue-500 mt-0.5 hidden group-hover:block hover:underline leading-none"
            >
              View all →
            </Link>
          </div>
        </div>

        <Link
          href={addHref}
          className="ml-3 shrink-0 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          + Add
        </Link>
      </div>

      {/* Expandable table — uses CSS grid-rows animation for smooth height */}
      <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-[grid-template-rows] duration-300 ease-in-out">
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
