// Entry types that always move stock to/from a vendor under job work — used
// to derive a running "at Vendor" balance alongside the warehouse balance.
// JOB_WORK_OUTPUT_IN is NOT always a vendor movement: normally it posts
// against a converted/finished item, distinct from the raw material sent
// out, and correctly stays excluded here. But when an order's Output
// Materials line happens to be recorded against the exact same material as
// one of that order's own INPUT lines — no real conversion, e.g. sorted or
// reprocessed scrap returned as the same scrap item — that OUTPUT_IN row
// genuinely *is* the vendor-return leg and must count. Use
// isVendorMovementRow() below (not a plain .includes check) everywhere a
// vendor delta is computed, so that case is never missed. See
// vw_current_vendor_stock / fn_vendor_balance_as_of (migration 123).
export const VENDOR_MOVEMENT_TYPES = [
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_CANCEL',
  'JOB_WORK_TRANSFER_OUT',
  'JOB_WORK_TRANSFER_IN',
]

/** Composite key identifying one (job-work order, material) input line —
 * used to test whether a JOB_WORK_OUTPUT_IN row shares its order's own
 * input material (see isVendorMovementRow). */
export function vendorOutputOrderKey(
  jobWorkOrderId: string,
  materialTypeId: string,
  materialSizeId: string | null | undefined
): string {
  return `${jobWorkOrderId}|${materialTypeId}|${materialSizeId ?? ''}`
}

/** The single authoritative "does this stock_ledger row represent material
 * moving to/from a job-work vendor" check — mirrors vw_current_vendor_stock
 * (087/090/123) exactly, so every report's vendor balance and "external
 * in/out" classification agrees with the DB view. `sameMaterialOutputKeys`
 * is the Set built from JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY via
 * vendorOutputOrderKey for every order referenced by a JOB_WORK_OUTPUT_IN
 * row in the report's dataset. */
export function isVendorMovementRow(
  entryType: string,
  referenceId: string | null | undefined,
  materialTypeId: string | null | undefined,
  materialSizeId: string | null | undefined,
  sameMaterialOutputKeys: ReadonlySet<string>
): boolean {
  if (VENDOR_MOVEMENT_TYPES.includes(entryType)) return true
  if (entryType !== 'JOB_WORK_OUTPUT_IN' || !referenceId || !materialTypeId) return false
  return sameMaterialOutputKeys.has(vendorOutputOrderKey(referenceId, materialTypeId, materialSizeId))
}
