import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date))
}

export function formatNumber(num: number, decimals = 3) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num)
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount)
}

export function generateReferenceNumber(prefix: string) {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${timestamp}-${random}`
}

export function getEntryTypeLabel(entryType: string) {
  const labels: Record<string, string> = {
    PURCHASE_IN: 'Purchase Inward',
    VENDOR_RETURN_IN: 'Vendor Return',
    SALE_OUT: 'Sale Dispatch',
    JOB_WORK_OUT: 'Job Work Dispatch',
    JOB_WORK_RETURN_IN: 'Job Work Return',
    JOB_WORK_OUTPUT_IN: 'Job Work Output',
    JOB_WORK_CANCEL: 'Job Work Cancelled',
    TRANSFER_OUT: 'Transfer Out',
    TRANSFER_IN: 'Transfer In',
    ADJUSTMENT_IN: 'Adjustment In',
    ADJUSTMENT_OUT: 'Adjustment Out',
    PURCHASE_CANCEL: 'Purchase Cancelled',
    SALE_CANCEL: 'Sale Cancelled',
  }
  return labels[entryType] || entryType
}

export function getEntryTypeColor(entryType: string) {
  const inTypes = ['PURCHASE_IN', 'VENDOR_RETURN_IN', 'JOB_WORK_RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'SALE_CANCEL']
  const cancelTypes = ['PURCHASE_CANCEL']
  if (cancelTypes.includes(entryType)) return 'text-red-500'
  return inTypes.includes(entryType) ? 'text-green-600' : 'text-red-600'
}

export function getJobWorkOrderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    dispatched: 'In Progress',
    partial_return: 'Partial Return',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return labels[status] || status
}

// Conversion factors to kilograms, for normalizing weight units across job work items
const UNIT_TO_KG: Record<string, number> = {
  kg: 1, kgs: 1, kilogram: 1, kilograms: 1,
  g: 0.001, gram: 0.001, grams: 0.001,
  mt: 1000, ton: 1000, tons: 1000, tonne: 1000, tonnes: 1000,
}

// Converts a quantity between weight units (e.g. Kgs <-> MT). Returns null if either
// unit is unrecognized or not a weight unit, so callers can fall back to the raw value.
export function convertQuantity(quantity: number, fromUnit?: string | null, toUnit?: string | null): number | null {
  if (!fromUnit || !toUnit) return null
  const from = UNIT_TO_KG[fromUnit.trim().toLowerCase()]
  const to = UNIT_TO_KG[toUnit.trim().toLowerCase()]
  if (from === undefined || to === undefined) return null
  return (quantity * from) / to
}

// True if two unit strings refer to the same weight unit (case/alias insensitive)
export function isSameUnit(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return a === b
  const na = UNIT_TO_KG[a.trim().toLowerCase()]
  const nb = UNIT_TO_KG[b.trim().toLowerCase()]
  if (na === undefined || nb === undefined) return a.trim().toLowerCase() === b.trim().toLowerCase()
  return na === nb
}

export function getRoleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: 'Admin',
    company_manager: 'Company Manager',
    warehouse_manager: 'Warehouse Manager',
    sales_manager: 'Sales Manager',
    billing_staff: 'Billing Staff',
  }
  return labels[role] || role
}
