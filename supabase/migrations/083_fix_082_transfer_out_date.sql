-- Same class of issue as migration 079: updating quantity_transferred_out
-- in 082 fired fn_job_work_item_to_ledger()'s UPDATE trigger before 082's
-- later step had linked 6ZNP's item back to FEG0's new item id, so the
-- trigger's dispatch_date lookup found nothing and fell back to
-- CURRENT_DATE. Realign this row to the transfer's actual date.
UPDATE stock_ledger
SET entry_date = '2024-04-24',
    notes = 'Backfilled missing JOB_WORK_TRANSFER_OUT for JWT-0826-0001 (migration 082/083)'
WHERE id = 'd872b004-7dd2-4f4b-87f5-a23c5bdb1903'
  AND entry_type = 'JOB_WORK_TRANSFER_OUT'
  AND reference_id = '12963adc-900a-4088-b4ad-fa35b747a3b2';
