/**
 * Static map of the Hasura relationships actually referenced in
 * src/lib/hasura/queries.ts, derived from the FK columns defined in
 * supabase/migrations/*.sql. Object relationships resolve a single related
 * row via a local FK column; array relationships resolve many rows via a FK
 * column on the related table. Add an entry here only when a future query
 * selects or filters on a new relationship.
 */

export type Relationship =
  | { kind: 'object'; table: string; localKey: string }
  | { kind: 'array'; table: string; foreignKey: string }

export const RELATIONSHIPS: Record<string, Record<string, Relationship>> = {
  warehouses: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
  },
  material_sizes: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
  },
  user_profiles: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
    warehouses: { kind: 'object', table: 'warehouses', localKey: 'warehouse_id' },
  },
  item_master: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    material_sizes: { kind: 'object', table: 'material_sizes', localKey: 'material_size_id' },
  },
  purchase_bills: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
    warehouses: { kind: 'object', table: 'warehouses', localKey: 'warehouse_id' },
    suppliers: { kind: 'object', table: 'suppliers', localKey: 'supplier_id' },
    purchase_bill_items: { kind: 'array', table: 'purchase_bill_items', foreignKey: 'bill_id' },
  },
  purchase_bill_items: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    // Filter-only — used in `where: { purchase_bill: { status: ... } }`, never selected.
    purchase_bill: { kind: 'object', table: 'purchase_bills', localKey: 'bill_id' },
  },
  transfers: {
    companies_from: { kind: 'object', table: 'companies', localKey: 'from_company_id' },
    companies_to: { kind: 'object', table: 'companies', localKey: 'to_company_id' },
    warehouses_from: { kind: 'object', table: 'warehouses', localKey: 'from_warehouse_id' },
    warehouses_to: { kind: 'object', table: 'warehouses', localKey: 'to_warehouse_id' },
    transfer_items: { kind: 'array', table: 'transfer_items', foreignKey: 'transfer_id' },
  },
  transfer_items: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    material_sizes: { kind: 'object', table: 'material_sizes', localKey: 'material_size_id' },
  },
  dispatch_orders: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
    warehouses: { kind: 'object', table: 'warehouses', localKey: 'warehouse_id' },
    customers: { kind: 'object', table: 'customers', localKey: 'customer_id' },
    dispatch_items: { kind: 'array', table: 'dispatch_items', foreignKey: 'dispatch_order_id' },
  },
  dispatch_items: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    // Filter-only — used in `where: { dispatch_order: { status: ... } }`, never selected.
    dispatch_order: { kind: 'object', table: 'dispatch_orders', localKey: 'dispatch_order_id' },
  },
  job_work_orders: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
    warehouses: { kind: 'object', table: 'warehouses', localKey: 'warehouse_id' },
    suppliers: { kind: 'object', table: 'suppliers', localKey: 'vendor_id' },
    job_work_items: { kind: 'array', table: 'job_work_items', foreignKey: 'job_work_order_id' },
    job_work_output_items: { kind: 'array', table: 'job_work_output_items', foreignKey: 'job_work_order_id' },
  },
  job_work_items: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    material_sizes: { kind: 'object', table: 'material_sizes', localKey: 'material_size_id' },
    // Filter-only — used in `where: { job_work_order: { status: ... } }`, never selected.
    job_work_order: { kind: 'object', table: 'job_work_orders', localKey: 'job_work_order_id' },
  },
  job_work_output_items: {
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    material_sizes: { kind: 'object', table: 'material_sizes', localKey: 'material_size_id' },
  },
  stock_ledger: {
    companies: { kind: 'object', table: 'companies', localKey: 'company_id' },
    warehouses: { kind: 'object', table: 'warehouses', localKey: 'warehouse_id' },
    material_types: { kind: 'object', table: 'material_types', localKey: 'material_type_id' },
    material_sizes: { kind: 'object', table: 'material_sizes', localKey: 'material_size_id' },
  },
  purchase_cancellations: {
    purchase_cancellation_items: { kind: 'array', table: 'purchase_cancellation_items', foreignKey: 'cancellation_id' },
  },
  dispatch_cancellations: {
    dispatch_cancellation_items: { kind: 'array', table: 'dispatch_cancellation_items', foreignKey: 'cancellation_id' },
  },
  job_work_cancellations: {
    job_work_cancellation_items: { kind: 'array', table: 'job_work_cancellation_items', foreignKey: 'cancellation_id' },
    job_work_cancellation_output_items: { kind: 'array', table: 'job_work_cancellation_output_items', foreignKey: 'cancellation_id' },
  },
}
