// Shared by server and browser code, so nothing here may import server modules.

/**
 * The whole-app switch. Off unless NEXT_PUBLIC_TRACKING_ENABLED is exactly
 * 'true': the sidebar link is absent and every tracking screen and route
 * answers Not Found. Company and warehouse switches apply on top of this.
 */
export function isTrackingMasterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TRACKING_ENABLED === 'true'
}

export type TrackingPermission = 'view' | 'label' | 'reprint_void' | 'settings' | 'pickup' | 'operate' | 'manage'

export const TRACKING_ROLES: Record<TrackingPermission, ReadonlySet<string>> = {
  view: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff', 'sales_manager']),
  label: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff']),
  reprint_void: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager']),
  settings: new Set(['admin', 'developer']),
  /** Create a pickup, link its sale and share it on WhatsApp. */
  pickup: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff', 'sales_manager']),
  /** Put away, move, scan onto a pickup, mark ready and hand over. */
  operate: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager', 'billing_staff']),
  /** Hold, missing, left warehouse, returns, splits, old stock, locations and cancelling a pickup. */
  manage: new Set(['admin', 'developer', 'company_manager', 'warehouse_manager']),
}

/** Roles that work across every company without a company on their profile. */
export const ALL_COMPANY_ROLES: ReadonlySet<string> = new Set(['admin', 'developer'])

export const MAX_BUNDLES = 99

/** What a test label's QR code and barcode contain. It can never match a real unit. */
export const TEST_LABEL_CODE = 'TEST-NOT-STOCK'

export const QR_REFERENCE_RE = /^WC[0-9]+-[0-9A-HJKMNP-TV-Z]{16}$/
export const STOCK_TRACKING_ID_RE = /^ST[0-9]{4}-[0-9]{6}$/
export const LOCATION_REF_RE = /^WL[0-9]+-[0-9A-HJKMNP-TV-Z]{16}$/
export const LOCATION_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,23}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WeightBasis = 'whole_line' | 'weighed' | 'estimated'
export type PrintStatus = 'requested' | 'sent' | 'confirmed' | 'failed'

export type LifecycleStatus =
  | 'LABELLED' | 'IN_STOCK' | 'ON_PICKUP' | 'READY' | 'PICKED_UP'
  | 'ON_HOLD' | 'MISSING' | 'LEFT_WAREHOUSE' | 'SPLIT'

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  LABELLED: 'Labelled',
  IN_STOCK: 'In stock',
  ON_PICKUP: 'On pickup',
  READY: 'Ready',
  PICKED_UP: 'Picked up',
  ON_HOLD: 'On hold',
  MISSING: 'Missing',
  LEFT_WAREHOUSE: 'Left warehouse',
  SPLIT: 'Split',
}

export type LocationType = 'STORAGE' | 'PICKUP_BAY' | 'HOLD'

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  STORAGE: 'Storage',
  PICKUP_BAY: 'Pickup bay',
  HOLD: 'Hold area',
}

export type PickupStatus = 'OPEN' | 'READY' | 'HANDED_OVER' | 'CANCELLED'

export const PICKUP_STATUS_LABELS: Record<PickupStatus, string> = {
  OPEN: 'Open',
  READY: 'Ready',
  HANDED_OVER: 'Handed over',
  CANCELLED: 'Cancelled',
}

/** What a device reports for a scan. Only stored where the company has switched GPS on. */
export interface ScanPosition {
  latitude: number
  longitude: number
  accuracy_m: number | null
}

export interface TrackingLocation {
  id: string
  location_ref: string
  company_id: string
  warehouse_id: string
  warehouse_name?: string
  code: string
  name: string | null
  location_type: LocationType
  is_active: boolean
  bundle_count: number
}

export interface PickupSummary {
  id: string
  pickup_no: string
  company_id: string
  warehouse_id: string
  warehouse_name?: string
  company_name?: string
  status: PickupStatus
  customer_id: string
  customer_name: string
  customer_phone: string | null
  dispatch_order_id: string | null
  invoice_number: string | null
  collector_name: string | null
  collector_phone: string | null
  vehicle_number: string | null
  handed_over_at: string | null
  cancel_reason: string | null
  created_at: string
  bundle_count: number
  total_quantity: string
  unit: string | null
}

export interface PickupLine {
  unit_id: string
  stock_tracking_id: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  purchase_line_id: string
  quantity: string
  unit: string
  lifecycle_status: LifecycleStatus
  location_code: string | null
  sale_line_id: string | null
  mismatch_reason: string | null
  returned_at: string | null
}

export interface VerifiableLine {
  purchase_line_id: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  unit: string
  bill_number: string | null
  bill_date: string | null
  company_id: string
  warehouse_id: string
  company_name: string
  warehouse_name: string
  book_quantity: string
  book_as_of: string | null
  labelled_quantity: string
}

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
  lifecycle_status: LifecycleStatus
  location_code: string | null
  status_reason: string | null
  source_type: 'NEW_PURCHASE' | 'VERIFIED_EXISTING' | 'SPLIT_PART'
  parent_unit_id: string | null
  part_no: number | null
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
