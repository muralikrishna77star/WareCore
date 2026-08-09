import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_PURCHASE_TAX_RATES_QUERY,
} from '@/lib/hasura/queries'

export interface MasterData {
  companies: { id: string; name: string; code: string }[]
  warehouses: { id: string; name: string; company_id: string }[]
  suppliers: { id: string; name: string }[]
  materialTypes: { id: string; code: string; description: string; unit: string }[]
  materialSizes: { id: string; material_type_id: string; size_label: string }[]
  taxRates: { id: string; name: string }[]
}

// One query per master type — reused both for the initial load
// (bills/import/[batchId]/page.tsx) and for the per-field refresh icon in
// RowEditor (e.g. after using its "+ Add New" dialog, or if a master
// record was added from a different screen/tab while this one was open).
export const MASTER_QUERIES = {
  companies: [ACTIVE_COMPANIES_QUERY, 'companies'],
  warehouses: [ACTIVE_WAREHOUSES_QUERY, 'warehouses'],
  suppliers: [ACTIVE_SUPPLIERS_QUERY, 'suppliers'],
  materialTypes: [ACTIVE_MATERIAL_TYPES_QUERY, 'material_types'],
  materialSizes: [ACTIVE_MATERIAL_SIZES_QUERY, 'material_sizes'],
  taxRates: [ACTIVE_PURCHASE_TAX_RATES_QUERY, 'tax_rates'],
} as const satisfies Record<keyof MasterData, readonly [string, string]>
