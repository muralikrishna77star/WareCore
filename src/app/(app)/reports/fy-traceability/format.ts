import { MONTH_NAMES } from '@/lib/dateRange'
import { formatDate } from '@/lib/dates'

export const fmtQ = (n: number) => (Math.abs(n) < 0.0005 ? '0.000' : n.toFixed(3))
export const fmtM = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtDate = (d: string | null) => formatDate(d)
export const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
