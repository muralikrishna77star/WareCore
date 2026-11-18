// Shared by server and browser code, so nothing here may import server modules.

/**
 * The whole-app switch. Off unless NEXT_PUBLIC_TRACKING_ENABLED is exactly
 * 'true': the sidebar link is absent and every tracking screen and route
 * answers Not Found. Company and warehouse switches apply on top of this.
 */
export function isTrackingMasterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TRACKING_ENABLED === 'true'
}

export type TrackingPermission = 'view' | 'label' | 'reprint_void' | 'settings'

export const TRACKING_ROLES: Record<TrackingPermission, ReadonlySet<string>> = {
  view: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff', 'sales_manager']),
  label: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff']),
  reprint_void: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager']),
  settings: new Set(['admin', 'developer']),
}

/** Roles that work across every company without a company on their profile. */
export const ALL_COMPANY_ROLES: ReadonlySet<string> = new Set(['admin', 'developer'])

export const MAX_BUNDLES = 99

/** What a test label's QR code and barcode contain. It can never match a real unit. */
export const TEST_LABEL_CODE = 'TEST-NOT-STOCK'

export const QR_REFERENCE_RE = /^WC[0-9]+-[0-9A-HJKMNP-TV-Z]{16}$/
export const STOCK_TRACKING_ID_RE = /^ST[0-9]{4}-[0-9]{6}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WeightBasis = 'whole_line' | 'weighed' | 'estimated'
export type PrintStatus = 'requested' | 'sent' | 'confirmed' | 'failed'

export interface TrackingUnit {
  id: string
  stock_tracking_id: string
  qr_reference: string
  company_id: string
  warehouse_id: string
  warehouse_name?: string
  company_name?: string
  purchase_line_id: string
  bill_number: string | null
  receipt_date: string | null
  item_code: string | null
  item_name: string | null
  size_label: string | null
  quantity: string
  unit: string
  bundle_no: number
  bundle_count: number
  weight_basis: WeightBasis
  status: 'ACTIVE' | 'VOIDED'
  void_reason: string | null
  created_at: string
}

export interface TrackingPrinter {
  id: string
  company_id: string
  warehouse_id: string
  warehouse_name?: string
  name: string
  model: string
  dpi: number
  label_width_mm: string
  label_height_mm: string
  is_active: boolean
}

export interface EligibleLine {
  purchase_line_id: string
  quantity: string
  unit: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  bill_number: string | null
  bill_date: string | null
  company_id: string
  warehouse_id: string
  company_name: string
  warehouse_name: string
}
