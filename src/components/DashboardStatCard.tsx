'use client'

import type { LucideIcon } from 'lucide-react'
import { useRecordPreview } from '@/components/RecordPreviewProvider'

export function DashboardStatCard({
  category,
  icon: Icon,
  value,
  title,
  caption,
  iconBg,
  iconColor,
}: {
  category: string | null
  icon: LucideIcon
  value: string
  title: string
  caption?: string
  iconBg: string
  iconColor: string
}) {
  const { openList } = useRecordPreview()
  return (
    <button
      type="button"
      disabled={!category}
      onClick={() => category && openList(category)}
      className={`rounded-xl border border-gray-200 bg-white p-5 text-left transition ${category ? 'hover:shadow-md hover:border-gray-300 cursor-pointer' : 'cursor-default'}`}
    >
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} strokeWidth={2} />
      </span>
      <p className="mt-3 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-700">{title}</p>
      {caption && <p className="mt-0.5 text-xs text-gray-400">{caption}</p>}
    </button>
  )
}
