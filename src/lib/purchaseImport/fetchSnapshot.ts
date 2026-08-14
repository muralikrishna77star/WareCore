// Server-only: fetches one consistent snapshot of the master data the
// import needs to resolve against, reusing the exact same GraphQL queries
// the manual entry form uses (src/lib/hasura/queries.ts) so "what counts as
// a valid Company/Warehouse/Supplier/..." never differs between the two
// entry paths.
import { hasuraQuery } from '@/lib/hasura/server'
import {
  ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY, ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY, ACTIVE_MATERIAL_SIZES_QUERY, ACTIVE_PURCHASE_TAX_RATES_QUERY,
  ALL_BILL_NUMBERS_QUERY, ALL_PURCHASE_LINE_IDS_QUERY, ITEM_MASTERS_QUERY,
} from '@/lib/hasura/queries'
import type { MasterDataSnapshot } from './types'

export async function fetchMasterDataSnapshot(): Promise<MasterDataSnapshot> {
  const [companies, warehouses, suppliers, materialTypes, materialSizes, taxRates, billNumbers, lineIds, itemMaster] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
    hasuraQuery(ACTIVE_PURCHASE_TAX_RATES_QUERY),
    hasuraQuery(ALL_BILL_NUMBERS_QUERY),
    hasuraQuery(ALL_PURCHASE_LINE_IDS_QUERY),
    // ALL items, not just active — an inactive item still "occupies" its
    // code (must never be reallocated) and its material/size combo is still
    // conceptually claimed (creating a second one would just be confusing).
    hasuraQuery(ITEM_MASTERS_QUERY),
  ])

  return {
    companies: companies.companies ?? [],
    warehouses: warehouses.warehouses ?? [],
    suppliers: suppliers.suppliers ?? [],
    materialTypes: materialTypes.material_types ?? [],
    materialSizes: materialSizes.material_sizes ?? [],
    taxRates: taxRates.tax_rates ?? [],
    existingBillNumbers: (billNumbers.purchase_bills ?? []).map((b: { bill_number: string }) => b.bill_number),
    existingLineIds: (lineIds.purchase_bill_items ?? []).map((i: { purchase_line_id: string }) => i.purchase_line_id).filter(Boolean),
    itemMaster: (itemMaster.item_master ?? []).map((i: { id: string; item_code: string; material_type_id: string; material_size_id: string | null }) => ({
      id: i.id, item_code: i.item_code, material_type_id: i.material_type_id, material_size_id: i.material_size_id,
    })),
  }
}
