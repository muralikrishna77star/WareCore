import { Package, IndianRupee, TriangleAlert, type LucideIcon } from 'lucide-react'
import { StatCard } from '@/components/StatCard'

/** Matches the `limit:` on the listing queries in src/lib/hasura/queries.ts. */
export const LISTING_ROW_LIMIT = 500

export function ListingSummary({
  count,
  countLabel,
  countIcon,
  totalQuantity,
  unit = 'tons',
  totalAmount,
  capped = false,
}: {
  count: number
  countLabel: string
  countIcon: LucideIcon
  totalQuantity: number
  unit?: string
  totalAmount?: number
  /** True when the query hit LISTING_ROW_LIMIT, so these totals are partial. */
  capped?: boolean
}) {
  return (
    <div className="space-y-3">
      {capped && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Showing the most recent {LISTING_ROW_LIMIT} records only — the selected range has more.
            The totals below cover just these {LISTING_ROW_LIMIT}. Narrow the range (pick a month
            instead of a whole year) to see the rest.
          </span>
        </div>
      )}
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
    </div>
  )
}
