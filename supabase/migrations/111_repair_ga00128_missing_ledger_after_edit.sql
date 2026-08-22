-- GA00128 (GA 0.70X1248) regressed after migration 109's fix: closing
-- balance went from 0.000 back to +0.610, and the ledger vendor balance
-- (6.885) fell 0.610 short of job-work records (7.495).
--
-- Root cause: order JW-MSWZ4GL8-HKJI (4148bce4-39a8-4f51-9b0e-d69b7c85dabc)
-- was edited today (2026-08-22) — almost certainly from a browser tab that
-- had loaded the order before migration 104's GI00069 transfer-destination
-- line existed. edit_job_work_order() unconditionally deletes every
-- existing job_work_items/stock_ledger row for the order and rebuilds only
-- from what the save submits, so anything not in that stale payload is
-- lost outright — this took out GI00069's line and ledger entirely (a
-- separate, not-yet-addressed regression) and, more subtly, left GA00128's
-- own line (id 8d5689a2, quantity_sent 0.610, purchase_line_id
-- GA0724-0002) present with no JOB_WORK_OUT ledger row to back it — the
-- rebuilt row's own INSERT should have posted one, but by the time of this
-- investigation none existed. Confirmed the exact shortfall (0.610 both
-- directions) accounts for the entire mismatch, nothing else changed.
--
-- Fix: post the missing JOB_WORK_OUT for the line that's already there —
-- no job_work_items changes needed, unlike migration 104's repair.

INSERT INTO stock_ledger (
  entry_type, company_id, warehouse_id, material_type_id, material_size_id,
  size_label, quantity, reference_type, reference_id, reference_number,
  entry_date, purchase_line_id
)
SELECT
  'JOB_WORK_OUT', jwo.company_id, jwo.warehouse_id,
  jwi.material_type_id, jwi.material_size_id, jwi.size_label,
  -jwi.quantity_sent, 'job_work', jwo.id, jwo.reference_number,
  jwo.dispatch_date, jwi.purchase_line_id
FROM job_work_items jwi
JOIN job_work_orders jwo ON jwo.id = jwi.job_work_order_id
WHERE jwi.id = '8d5689a2-e4f1-4566-83d0-f65bfc56d201'
  AND jwi.quantity_sent = 0.610
  AND NOT EXISTS (
    SELECT 1 FROM stock_ledger sl
    WHERE sl.reference_id = jwi.job_work_order_id AND sl.entry_type = 'JOB_WORK_OUT'
      AND sl.purchase_line_id IS NOT DISTINCT FROM jwi.purchase_line_id
  );
