// Entry types that move stock to/from a vendor under job work — used to
// derive a running "at Vendor" balance alongside the warehouse balance.
// JOB_WORK_OUTPUT_IN is deliberately excluded: it posts against the output
// item's own material_type_id (finished good), never the raw material sent
// out, so it never contributes to that item's vendor-held quantity.
export const VENDOR_MOVEMENT_TYPES = [
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_CANCEL',
  'JOB_WORK_TRANSFER_OUT',
  'JOB_WORK_TRANSFER_IN',
]
