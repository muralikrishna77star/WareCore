-- Restore JW-MSA5JKMM-FEG0's original vendor (Arun Engineering).
--
-- Its vendor_id was retroactively changed to MAC MANS INDUSTRIES sometime
-- after the JWT-0826-0001 transfer (from Arun Engineering -> MAC MANS
-- INDUSTRIES) had already been recorded, which made the transfer look like a
-- self-transfer ("MAC MANS INDUSTRIES -> MAC MANS INDUSTRIES") in the Item
-- Ledger / Vendorwise Stock Movement reports even though the transfer audit
-- trail (job_work_transfers.from_vendor_id) and the paired
-- JOB_WORK_TRANSFER_IN row both correctly show Arun Engineering as the
-- source. FEG0 has a single line item, already fully transferred out
-- (quantity_transferred_out = quantity_sent = 1.950), so this only changes
-- which vendor the historical Job Work Out / Transfer Out rows attribute to
-- — the final outstanding-at-vendor total (1.950 MT at MAC MANS INDUSTRIES,
-- 0 at Arun Engineering) is unchanged.
--
-- Confirmed with the user.
UPDATE job_work_orders
SET vendor_id = 'a9281561-a471-4ef5-881c-7db24c02e81c', -- Arun Engineering
    updated_at = NOW()
WHERE id = '12963adc-900a-4088-b4ad-fa35b747a3b2' -- JW-MSA5JKMM-FEG0
  AND vendor_id = '11d5254c-f0c1-4b23-889c-628d86436acd'; -- currently MAC MANS INDUSTRIES
