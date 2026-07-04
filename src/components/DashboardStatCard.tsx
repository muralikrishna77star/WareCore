'use client'

import { useRecordPreview } from '@/components/RecordPreviewProvider'

export function DashboardStatCard({
  category,
  icon,
  value,
  title,
  color,
  textColor,
}: {
  category: string | null
  icon: string
  value: string
  title: string
  color: string
  textColor: string
}) {
  const { openList } = useRecordPreview()
  return (
    <button
      type="button"
      disabled={!category}
      onClick={() => category && openList(category)}
      className={`rounded-xl border p-5 text-left ${color} ${category ? 'hover:brightness-95 transition cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className={`mt-3 text-2xl font-bold ${textColor}`}>{value}</p>
      <p className="mt-1 text-sm text-gray-600">{title}</p>
    </button>
  )
}
