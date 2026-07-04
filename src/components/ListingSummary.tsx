export function ListingSummary({
  count,
  countLabel,
  totalQuantity,
  unit = 'tons',
  totalAmount,
}: {
  count: number
  countLabel: string
  totalQuantity: number
  unit?: string
  totalAmount?: number
}) {
  return (
    <div className="flex flex-wrap gap-6 rounded-xl border bg-white p-4">
      <div>
        <p className="text-xs text-gray-500">{countLabel}{count !== 1 ? 's' : ''}</p>
        <p className="text-lg font-bold text-gray-900">{count}</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">Total Quantity</p>
        <p className="text-lg font-bold text-gray-900">{totalQuantity.toFixed(3)} {unit}</p>
      </div>
      {totalAmount != null && (
        <div>
          <p className="text-xs text-gray-500">Total Amount</p>
          <p className="text-lg font-bold text-gray-900">
            ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </p>
        </div>
      )}
    </div>
  )
}
