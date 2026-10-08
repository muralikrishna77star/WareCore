// Shapes returned by preview_job_work_transfer_reversal() and
// reverse_job_work_transfer_items() (migration 157), shared by the API
// routes and the Reverse Transfer dialog.

export interface TransferReversalLine {
  id: string
  item_name: string | null
  size_label: string | null
  purchase_line_id: string | null
  job_line_id: string | null
  quantity: number
  unit: string | null
  reversed_at: string | null
  reversal_notes: string | null
  /** Why this line can't be reversed right now; null when it can. */
  blocked_reason: string | null
}

export interface TransferReversalPreview {
  transfer_number: string
  transfer_date: string
  from_reference_number: string | null
  from_vendor_name: string | null
  to_reference_number: string | null
  to_vendor_name: string | null
  items: TransferReversalLine[]
}

export interface TransferReversalResult {
  success: boolean
  error?: string
  reversed?: number
  destination_deactivated?: boolean
}

export { UUID_RE } from './reportLinks'
