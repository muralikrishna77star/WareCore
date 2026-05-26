export type UserRole = 'admin' | 'company_manager' | 'warehouse_manager' | 'sales_manager' | 'billing_staff'

export type StockEntryType =
  | 'PURCHASE_IN'
  | 'VENDOR_RETURN_IN'
  | 'SALE_OUT'
  | 'JOB_WORK_OUT'
  | 'JOB_WORK_RETURN_IN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'

export type TransferStatus = 'pending' | 'in_transit' | 'completed' | 'cancelled'
export type JobWorkStatus = 'dispatched' | 'partial_return' | 'completed' | 'cancelled'

export interface Company {
  id: string
  name: string
  short_name?: string
  code: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  phone?: string
  email?: string
  gstin?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Warehouse {
  id: string
  company_id: string
  name: string
  address?: string
  city?: string
  state?: string
  is_active: boolean
  created_at: string
  updated_at: string
  company?: Company
}

export interface Supplier {
  id: string
  name: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  gstin?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  name: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  gstin?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ItemGroup {
  id: string
  group_code: string
  group_desc?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MaterialType {
  id: string
  name: string
  unit: string
  description?: string
  is_active: boolean
  created_at: string
}

export interface MaterialSize {
  id: string
  material_type_id: string
  size_label: string
  thickness?: number
  width?: number
  is_active: boolean
  created_at: string
  material_type?: MaterialType
}

export interface ItemMaster {
  id: string
  item_code: string
  item_name: string
  item_group_id?: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  description?: string
  unit: string
  is_active: boolean
  created_at: string
  updated_at: string
  material_type?: MaterialType
  material_size?: MaterialSize
  item_group?: ItemGroup
}

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  company_id?: string
  phone?: string
  is_active: boolean
  created_at: string
  updated_at: string
  company?: Company
}

export interface PurchaseBill {
  id: string
  supplier_id: string
  company_id: string
  warehouse_id: string
  bill_number: string
  bill_date: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  supplier?: Supplier
  company?: Company
  warehouse?: Warehouse
  items?: PurchaseBillItem[]
}

export interface PurchaseBillItem {
  id: string
  bill_id: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  quantity: number
  unit: string
  rate?: number
  amount?: number
  created_at: string
  material_type?: MaterialType
  material_size?: MaterialSize
}

export interface StockLedgerEntry {
  id: string
  entry_type: StockEntryType
  company_id: string
  warehouse_id: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  quantity: number
  reference_type?: string
  reference_id?: string
  reference_number?: string
  notes?: string
  entry_date: string
  created_by?: string
  created_at: string
  company?: Company
  warehouse?: Warehouse
  material_type?: MaterialType
  material_size?: MaterialSize
}

export interface Transfer {
  id: string
  reference_number: string
  from_company_id: string
  from_warehouse_id: string
  to_company_id: string
  to_warehouse_id: string
  transfer_date: string
  status: TransferStatus
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  from_company?: Company
  from_warehouse?: Warehouse
  to_company?: Company
  to_warehouse?: Warehouse
  items?: TransferItem[]
}

export interface TransferItem {
  id: string
  transfer_id: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  quantity: number
  unit: string
  created_at: string
  material_type?: MaterialType
  material_size?: MaterialSize
}

export interface JobWorkOrder {
  id: string
  reference_number: string
  vendor_id: string
  company_id: string
  warehouse_id: string
  dispatch_date: string
  expected_return_date?: string
  actual_return_date?: string
  status: JobWorkStatus
  work_description?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  vendor?: Supplier
  company?: Company
  warehouse?: Warehouse
  items?: JobWorkItem[]
}

export interface JobWorkItem {
  id: string
  job_work_order_id: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  quantity_sent: number
  quantity_received: number
  unit: string
  created_at: string
  updated_at: string
  material_type?: MaterialType
  material_size?: MaterialSize
}

export interface DispatchOrder {
  id: string
  invoice_number: string
  customer_id: string
  company_id: string
  warehouse_id: string
  dispatch_date: string
  vehicle_number?: string
  driver_name?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  customer?: Customer
  company?: Company
  warehouse?: Warehouse
  items?: DispatchItem[]
}

export interface DispatchItem {
  id: string
  dispatch_order_id: string
  material_type_id: string
  material_size_id?: string
  size_label?: string
  quantity: number
  unit: string
  rate?: number
  amount?: number
  created_at: string
  material_type?: MaterialType
  material_size?: MaterialSize
}

export interface CurrentStock {
  company_id: string
  company_name: string
  company_code: string
  warehouse_id: string
  warehouse_name: string
  material_type_id: string
  material_type_name: string
  unit: string
  material_size_id?: string
  size_label?: string
  current_stock: number
}

export interface StockAtVendor {
  vendor_id: string
  vendor_name: string
  company_id: string
  company_name: string
  material_type_id: string
  material_type_name: string
  size_label?: string
  pending_quantity: number
  unit: string
}

// Navigation item
export interface NavItem {
  title: string
  href: string
  icon?: React.ComponentType<{ className?: string }>
  children?: NavItem[]
  roles?: UserRole[]
}
