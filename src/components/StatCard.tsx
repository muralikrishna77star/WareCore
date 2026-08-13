import type { LucideIcon } from 'lucide-react'

export function StatCard({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
  caption,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  value: string
  label: string
  caption?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-5 w-5 ${iconColor}`} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
        <p className="text-xs text-gray-500 truncate">{label}</p>
        {caption && <p className="text-xs text-gray-400 truncate">{caption}</p>}
      </div>
    </div>
  )
}
