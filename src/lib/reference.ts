export type ReferenceType = 'purchase_bill' | 'dispatch' | 'job_work' | 'transfer'

export const REFERENCE_ROUTE: Record<ReferenceType, string> = {
  purchase_bill: '/bills',
  dispatch: '/dispatch',
  job_work: '/jobwork',
  transfer: '/transfers',
}

export const REFERENCE_LABEL: Record<ReferenceType, string> = {
  purchase_bill: 'Purchase Bill',
  dispatch: 'Sale / Dispatch',
  job_work: 'Job Work Order',
  transfer: 'Transfer',
}

export function isReferenceType(value: unknown): value is ReferenceType {
  return value === 'purchase_bill' || value === 'dispatch' || value === 'job_work' || value === 'transfer'
}
