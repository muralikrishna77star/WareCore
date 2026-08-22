-- Remove a bogus GI00069 (GI 0.75X1666) job work transfer and its source
-- dispatch. Root cause behind today's whole investigation: the transfer
-- (job_work_transfers e91e1005-96fb-4789-a46b-469088dbbb28, 0.610 MT,
-- Modern Age Metal Processors -> Arun Engineering) was dated 2024-07-23,
-- but the purchase line it draws from (GI0724-0020) wasn't invoiced until
-- 2024-07-31 -- eight days AFTER the transfer supposedly happened. That's
-- physically impossible; the transfer (and, per the user, the underlying
-- GI00069 dispatch on JW-MSN4Q1KK-SGL9 itself) never actually occurred.
-- Confirmed with the user: remove both.
--
-- 1. delete_job_work_transfer() reverses the transfer properly: resets the
--    source line's quantity_transferred_out to 0, posts a JOB_WORK_CANCEL
--    reversal (nets off the original erroneous JOB_WORK_TRANSFER_OUT), and
--    archives+deletes the dedicated destination order (migration 113,
--    JW-MT46U3HO-VRW8) this session created for it.
-- 2. With the source line now "clean" (no transfer, no returns), directly
--    deleting it fires the new fn_job_work_item_deleted() trigger
--    (migration 114), which posts its own JOB_WORK_CANCEL reversing the
--    original JOB_WORK_OUT -- removing the GI00069 line from
--    JW-MSN4Q1KK-SGL9 entirely, per the user's explicit instruction. The
--    other two GI00069 lines on that order (GI0724-0021, GI0724-0022) are
--    untouched -- confirmed with the user as out of scope.

BEGIN;

SELECT delete_job_work_transfer(
  'e91e1005-96fb-4789-a46b-469088dbbb28',
  'Transfer never actually happened -- dated before its source purchase line (GI0724-0020, invoiced 2024-07-31) even existed'
);

DELETE FROM job_work_items
WHERE id = '704c49cc-4891-4999-8d99-738bd34becbb'
  AND job_work_order_id = 'f90b2efe-34a3-4287-b51e-c1fc890aea68'
  AND quantity_transferred_out = 0
  AND quantity_received = 0;

COMMIT;
