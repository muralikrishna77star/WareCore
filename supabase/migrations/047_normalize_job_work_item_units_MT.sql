-- Migration 047: Normalize job_work_items.unit to 'MT'
-- All quantities in job_work_items were already recorded in MT;
-- the unit column had residual 'kg'/'tons' labels from historical data entry.
-- Correct the label without changing quantity values.
UPDATE job_work_items SET unit = 'MT' WHERE unit != 'MT';
