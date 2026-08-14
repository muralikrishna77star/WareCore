-- Migration 078's UPDATE of job_work_items.quantity_transferred_out fired
-- fn_job_work_item_to_ledger()'s own UPDATE trigger, which auto-inserted a
-- JOB_WORK_TRANSFER_OUT row before 078's later steps had linked the
-- destination item's source_job_work_item_id — so the trigger's dispatch_date
-- lookup found nothing and fell back to CURRENT_DATE (2026-08-05) instead of
-- the transfer's actual date (2024-04-24, matching its paired
-- JOB_WORK_TRANSFER_IN). Same class of bug as migration 065; realign this one
-- row and replace its generic auto-generated note with one that references
-- the transfer explicitly, since 078's own guarded INSERT skipped it as a
-- (mistaken) duplicate.
UPDATE stock_ledger
SET entry_date = '2024-04-24',
    notes = 'Backfilled missing JOB_WORK_TRANSFER_OUT for JWT-0826-0001 (migration 078/079)'
WHERE id = 'c5b6e343-dc14-49bf-a1bc-4fc2cc4339dd'
  AND entry_type = 'JOB_WORK_TRANSFER_OUT'
  AND reference_id = '12963adc-900a-4088-b4ad-fa35b747a3b2';
