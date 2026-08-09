-- ============================================================
-- Stage D pilot — typed repair execution function
-- ============================================================
-- Archives a confirmed technical duplicate stock_ledger row (the REC-001
-- CONFIRMED / CR00700 defect shape — see supabase/migrations/084 for the
-- one-off manual precedent this automates). Per
-- docs/data-integrity/REPAIR_GOVERNANCE.md:
--  - a single reviewed, typed function, taking only a batch id + executing
--    user, that re-validates everything itself — never arbitrary SQL
--    generated per request;
--  - copies before-image to repair_audit_rows, performs the repair, then
--    re-runs the originating rule scoped to the same fingerprint — if it
--    STILL fires, RAISE EXCEPTION to roll back the entire transaction
--    (the repair only commits if it demonstrably fixed what it claimed to).
--
-- Caller contract: the batch must already be in status = 'EXECUTING',
-- written by a PRECEDING, separate statement from the API route (so that
-- state is durable and a second concurrent execute attempt is rejected
-- before this function's own transaction even starts — see
-- src/app/api/data-integrity/repair-batches/[id]/route.ts). This function
-- never writes 'EXECUTING' itself — only 'EXECUTED' on success. On failure
-- it RAISEs, which rolls back everything it did (deletes and audit rows
-- included); the caller is responsible for a SEPARATE subsequent statement
-- recording 'EXECUTION_FAILED' + error_message, since that write must
-- survive after this transaction is undone.
--
-- Deliberately does NOT trust the batch's own `proposal` JSON (which
-- reproduces of REC-001's evidence, captured at propose time) as authority
-- for which rows to archive — it re-derives the duplicate group fresh from
-- fn_reconcile_rec_001 at execution time, so a stale proposal (e.g. someone
-- already fixed it by hand, or the duplicate set changed) can never cause a
-- wrong row to be archived.
CREATE OR REPLACE FUNCTION fn_repair_archive_duplicate_ledger_row(
  p_batch_id UUID,
  p_executed_by UUID
) RETURNS repair_batches AS $$
DECLARE
  v_batch       repair_batches%ROWTYPE;
  v_exception   reconciliation_exceptions%ROWTYPE;
  v_settings_on BOOLEAN;
  v_candidate   reconciliation_candidate;
  v_post_check  reconciliation_candidate;
  v_ids         UUID[];
  v_keep_id     UUID;
  v_archive_ids UUID[];
  v_archive_id  UUID;
  v_row         stock_ledger%ROWTYPE;
  v_wide_from   DATE := '1900-01-01';
  v_wide_to     DATE := '2999-12-31';
BEGIN
  SELECT * INTO v_batch FROM repair_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair batch % not found', p_batch_id;
  END IF;
  IF v_batch.status <> 'EXECUTING' THEN
    RAISE EXCEPTION 'repair batch % must be EXECUTING to run this function (status=%)', p_batch_id, v_batch.status;
  END IF;
  IF v_batch.proposed_action <> 'ARCHIVE_DUPLICATE_LEDGER_ROW' THEN
    RAISE EXCEPTION 'batch % proposed_action is % — this function only executes ARCHIVE_DUPLICATE_LEDGER_ROW', p_batch_id, v_batch.proposed_action;
  END IF;

  -- Belt-and-suspenders re-check of the maker-checker invariant the DB CHECK
  -- constraint already enforces on repair_batches (chk_repair_batches_maker_checker)
  -- — this function must never assume its caller validated anything.
  IF v_batch.requested_by IS NOT NULL AND v_batch.approved_by IS NOT NULL
     AND v_batch.requested_by = v_batch.approved_by THEN
    RAISE EXCEPTION 'batch % failed maker-checker: requested_by = approved_by', p_batch_id;
  END IF;

  SELECT repair_execution_enabled INTO v_settings_on FROM reconciliation_settings WHERE id = TRUE;
  IF NOT COALESCE(v_settings_on, FALSE) THEN
    RAISE EXCEPTION 'repair execution is disabled (reconciliation_settings.repair_execution_enabled = FALSE)';
  END IF;

  SELECT * INTO v_exception FROM reconciliation_exceptions WHERE id = v_batch.exception_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exception % (batch %) not found', v_batch.exception_id, p_batch_id;
  END IF;
  IF v_exception.status IN ('RESOLVED', 'IGNORED') THEN
    RAISE EXCEPTION 'exception % is already % — nothing to repair', v_exception.exception_number, v_exception.status;
  END IF;

  -- Re-derive the CURRENT duplicate group fresh from REC-001 itself, scoped
  -- to the exception's own company_id — this also prevents a same-text
  -- fingerprint collision across two different companies from ever being
  -- considered, since fn_reconcile_rec_001's fingerprint string does not
  -- itself include company_id.
  SELECT c.* INTO v_candidate
  FROM fn_reconcile_rec_001(v_exception.company_id, v_wide_from, v_wide_to) c
  WHERE c.fingerprint = v_exception.fingerprint;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REC-001 no longer detects fingerprint % — exception may already be resolved; run a scan instead of executing this batch', v_exception.fingerprint;
  END IF;
  IF v_candidate.evidence->>'confidence' <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'fingerprint % is no longer CONFIRMED (currently %) — refusing to auto-archive, requires human review', v_exception.fingerprint, v_candidate.evidence->>'confidence';
  END IF;

  SELECT array_agg(elem::uuid ORDER BY ord) INTO v_ids
  FROM jsonb_array_elements_text(v_candidate.evidence->'duplicate_ledger_ids') WITH ORDINALITY AS t(elem, ord);

  IF v_ids IS NULL OR array_length(v_ids, 1) < 2 THEN
    RAISE EXCEPTION 'fingerprint % evidence has fewer than 2 duplicate_ledger_ids — nothing to archive', v_exception.fingerprint;
  END IF;

  -- REC-001 orders duplicate_ledger_ids by created_at ascending (see
  -- array_agg(id ORDER BY created_at) in 088) — keep the earliest
  -- (the original, legitimate posting), archive every later one.
  v_keep_id := v_ids[1];
  v_archive_ids := v_ids[2:array_length(v_ids, 1)];

  FOREACH v_archive_id IN ARRAY v_archive_ids LOOP
    SELECT * INTO v_row FROM stock_ledger WHERE id = v_archive_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'duplicate ledger row % (fingerprint %) no longer exists — refusing to proceed with a stale duplicate set', v_archive_id, v_exception.fingerprint;
    END IF;

    INSERT INTO repair_audit_rows (repair_batch_id, table_name, record_id, action, before_image, after_image)
    VALUES (p_batch_id, 'stock_ledger', v_archive_id::text, 'ARCHIVE', to_jsonb(v_row), NULL);

    DELETE FROM stock_ledger WHERE id = v_archive_id;
  END LOOP;

  -- Re-verify by calling the SAME rule function, scoped to the SAME
  -- fingerprint, before committing anything. If it still fires, roll back
  -- the ENTIRE transaction — the DELETEs and repair_audit_rows inserts
  -- above included. This is the check-then-commit-or-rollback step
  -- REPAIR_GOVERNANCE.md requires: the repair only commits if it
  -- demonstrably fixed what it claimed to fix.
  SELECT c.* INTO v_post_check
  FROM fn_reconcile_rec_001(v_exception.company_id, v_wide_from, v_wide_to) c
  WHERE c.fingerprint = v_exception.fingerprint;

  IF FOUND THEN
    RAISE EXCEPTION 'fingerprint % is STILL detected by REC-001 after the repair (dup_count=%) — rolling back the entire batch', v_exception.fingerprint, v_post_check.evidence->>'dup_count';
  END IF;

  UPDATE repair_batches SET
    status = 'EXECUTED',
    executed_by = p_executed_by,
    executed_at = NOW(),
    after_preview_snapshot = to_jsonb(v_exception),
    execution_result = jsonb_build_object(
      'kept_ledger_id', v_keep_id,
      'archived_ledger_ids', to_jsonb(v_archive_ids),
      'archived_count', array_length(v_archive_ids, 1)
    ),
    validation_result = jsonb_build_object('post_repair_rec_001_check', 'not_detected', 'checked_at', NOW())
  WHERE id = p_batch_id
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_repair_archive_duplicate_ledger_row IS
  'Stage D pilot repair execution for REC-001 CONFIRMED duplicates only. Re-derives the duplicate group fresh from fn_reconcile_rec_001 at execution time (never trusts the batch''s own proposal JSON), archives every row but the earliest, then re-runs the same rule scoped to the same fingerprint — RAISEs (rolling back everything, including audit rows already written) if it still fires. See docs/data-integrity/REPAIR_GOVERNANCE.md.';
