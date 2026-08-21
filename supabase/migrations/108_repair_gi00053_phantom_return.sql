-- Fix GI00053 (GI 0.70X1220)'s item reconciliation mismatch: ledger vendor
-- balance (1.186) didn't match job-work records (0.000).
--
-- job_work_items.quantity_received on line JW-1205-0003 (order
-- JW-MR0J2NYQ-HEKS, vendor Mass Decoilers, purchase_line_id GI0524-0022) was
-- set to 1.186 (= quantity_sent, "fully returned"), but nothing backs that:
-- no JOB_WORK_RETURN_IN row was ever posted to stock_ledger for this line,
-- and no job_work_output_items record exists for its job_line_id either —
-- the only ledger entry for this line is still the original JOB_WORK_OUT
-- (-1.186). Confirmed with the user: this material is still physically at
-- the vendor: it was never returned. Resetting quantity_received to 0
-- restores that — the line goes back to fully pending, matching the
-- ledger's own 1.186 MT and v_stock_at_vendors' independent calculation.

UPDATE job_work_items
SET quantity_received = 0, updated_at = NOW()
WHERE id = 'c766e2a1-583a-48e5-900a-36aac59de811'
  AND quantity_received = 1.186
  AND quantity_transferred_out = 0;
