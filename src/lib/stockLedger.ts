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

/** "Does this stock_ledger row represent material moving to/from a job-work
 * vendor" check for reports that only have an item's OWN ledger rows in
 * hand — mirrors vw_current_vendor_stock's 087/090/123 rules.
 * `sameMaterialOutputKeys` is the Set built from
 * JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY via vendorOutputOrderKey for every
 * order referenced by a JOB_WORK_OUTPUT_IN row in the report's dataset.
 *
 * Known limit (migration 142): an Output Materials line recorded as a
 * DIFFERENT item than the input it consumed (source_job_line_id set, e.g.
 * OTH00042 0.85X995 slit into OT00006 0.90X121) is posted under the output
 * item, so it never appears among the input item's own rows and this check
 * can't see it. The DB view vw_job_work_vendor_movements attributes such
 * rows back to the input line; anything that must match the "At Vendor"
 * card exactly (the Item Stock Ledger report, the reconcile-items API)
 * reads that view instead of using this helper. */
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
