-- Rename material_types.name to description
-- Drop the old (optional) description column first to avoid conflict

ALTER TABLE material_types DROP COLUMN IF EXISTS description;
ALTER TABLE material_types RENAME COLUMN name TO description;

-- Update unique constraint (name had a unique constraint via the original schema)
ALTER TABLE material_types DROP CONSTRAINT IF EXISTS material_types_name_key;
ALTER TABLE material_types ADD CONSTRAINT material_types_description_key UNIQUE (description);

-- Seed initial material types — explicit, fixed ids (matching production's
-- actual current values for these 5 rows) rather than the default
-- uuid_generate_v4(), so every fresh database converges on the SAME ids
-- production already has. Without this, each new install (every desktop
-- build, any other from-scratch bootstrap) got its own random ids for
-- these 5 rows; restoring a full backup afterward then silently dropped
-- them (ON CONFLICT (code) hitting the unique constraint on a row with a
-- different id) along with everything the backup's rows for these
-- material types were referenced by — thousands of stock_ledger,
-- purchase_bill_items, dispatch_items, job_work_items, and material_sizes
-- rows lost with only a swallowed FK-violation error to show for it. This
-- edit has no effect on any database migrations already ran on (this file
-- only executes once per fresh install, tracked in schema_migrations) — it
-- only fixes future fresh installs going forward.
INSERT INTO material_types (id, code, description, unit) VALUES
  ('d2e3f40f-8076-46fa-a3cc-f52a661972d7', 'CR', 'Cold Rolled Steel Coils and Sheets', 'kg'),
  ('84418b20-4148-488c-a57f-cebbf249f08a', 'GA', 'Galvannealed Steel Coils and Products', 'kg'),
  ('cd18bd17-6f05-44ab-a59d-486d0562131b', 'GI', 'Galvanized Iron Coils and Sheets', 'kg'),
  ('6de431ca-dbeb-4ed8-b084-67ecfa03f1d9', 'HR', 'Hot Rolled Steel Coils and Channels', 'kg'),
  ('40215bef-0196-4451-891a-ba9cc6cab35e', 'OT', 'Other Materials and Miscellaneous Items', 'tons')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, unit = EXCLUDED.unit;
