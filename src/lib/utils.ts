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
    TRANSFER_OUT: 'Transfer Out',
    TRANSFER_IN: 'Transfer In',
    ADJUSTMENT_IN: 'Adjustment In',
    ADJUSTMENT_OUT: 'Adjustment Out',
  }
  return labels[entryType] || entryType
}

export function getEntryTypeColor(entryType: string) {
  const inTypes = ['PURCHASE_IN', 'VENDOR_RETURN_IN', 'JOB_WORK_RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN']
  return inTypes.includes(entryType) ? 'text-green-600' : 'text-red-600'
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
