// One-off forensic repairs of specific PRODUCTION rows (hard-coded row ids,
// or "expected N rows, found M — aborting" guards). They were meant to run
// exactly once against the live database and cannot apply to a database
// that doesn't hold those rows:
//
//  - a fresh desktop install starts empty, and
//  - a desktop install restored from a backup of the live data already
//    contains every repair's result.
//
// So the desktop launcher (scripts/desktop/start.mjs) runs these
// best-effort — one that can't apply is skipped with a note instead of
// stopping the app — and the test harness (scripts/test/testDb.mjs) skips
// them. Every other migration must still apply cleanly.
//
// Adding a new repair migration of this kind? Add it here, then run
// `node scripts/test/check-fresh-install-migrations.mjs`.
export const PRODUCTION_DATA_DEPENDENT_MIGRATIONS = new Set([
  '063_restore_job_work_transfer_ledger.sql',
  '064_fix_backfilled_transfer_ledger_timestamps.sql',
  '071_repair_vendor_direct_sale_duplicates.sql',
  '073_backfill_missing_2024_ledger_entries.sql',
  '077_backfill_missing_job_work_transfer_out.sql',
  '078_repair_jw_msa5jkmm_feg0_transfer.sql',
  '079_fix_078_transfer_out_date.sql',
  '080_fix_jw_msa5jkmm_feg0_vendor.sql',
  '082_redo_jw_msa5jkmm_feg0_repair.sql',
  '083_fix_082_transfer_out_date.sql',
  '084_repair_cr00700_duplicate_cancel.sql',
  '113_repair_gi00069_dedicated_transfer_order.sql',
  '119_repair_missing_transfer_jwt_0826_0012.sql',
  '121_backfill_intercompany_stock_sharing.sql',
  '122_correct_cr0524_0065_misattribution.sql',
  '124_fix_jwt_0826_0012_qty_sent_corruption.sql',
  '133_backfill_intercompany_stock_sharing_reverse.sql',
  '137_repair_jw_mtbes07o_sbt8_noop_ledger_pairs.sql',
  '139_repair_ga00190_ga00193_output_size_mixup.sql',
  '140_backfill_intercompany_stock_sharing_oct_nov_2024.sql',
  '143_repair_11_open_rec005_exceptions_sep_2026.sql',
  '144_repair_cr1224_intercompany_purchase_lines.sql',
  '148_cancel_duplicate_jw_mtwvzzut_19g7.sql',
  '152_restore_deleted_purchase_cancels_bill_0125_0428.sql',
  '154_fix_hr00206_missing_size.sql',
  '155_repair_17_open_exceptions_oct_2026.sql',
])
