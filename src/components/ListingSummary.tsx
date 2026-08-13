import { Package, IndianRupee, type LucideIcon } from 'lucide-react'
import { StatCard } from '@/components/StatCard'

export function ListingSummary({
  count,
  countLabel,
  countIcon,
  totalQuantity,
  unit = 'tons',
  totalAmount,
}: {
  count: number
  countLabel: string
  countIcon: LucideIcon
  totalQuantity: number
  unit?: string
  totalAmount?: number
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <StatCard
        icon={countIcon}
        iconBg="bg-blue-100"
        iconColor="text-blue-600"
        value={String(count)}
        label={`${countLabel}${count !== 1 ? 's' : ''}`}
      />
      <StatCard
        icon={Package}
        iconBg="bg-green-100"
        iconColor="text-green-600"
        value={`${totalQuantity.toFixed(3)} ${unit}`}
        label="Total Quantity"
      />
      {totalAmount != null && (
        <StatCard
          icon={IndianRupee}
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
          value={`₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          label="Total Amount"
        />
      )}
    </div>
  )
}
