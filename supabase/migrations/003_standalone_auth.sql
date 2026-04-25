-- ============================================================
-- WareCore WMS - Standalone Auth Migration
-- Removes Supabase dependency from user_profiles and adds
-- email + password_hash for self-managed authentication.
--
-- Run ONCE after removing Supabase from the project.
-- ============================================================

-- 1. Drop the foreign key to Supabase's auth.users
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

-- 2. Change PK to auto-generated UUID (no longer tied to auth.users)
ALTER TABLE user_profiles ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE user_profiles ADD PRIMARY KEY (id);

-- 3. Add email column
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT UNIQUE NOT NULL DEFAULT '';
-- Remove the placeholder default after adding
ALTER TABLE user_profiles ALTER COLUMN email DROP DEFAULT;

-- 4. Add password_hash column (bcrypt hash stored server-side only)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ALTER COLUMN password_hash DROP DEFAULT;

-- 5. Remove created_by references to auth.users from other tables
ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS purchase_bills_created_by_fkey;
ALTER TABLE purchase_bills ALTER COLUMN created_by TYPE UUID USING created_by::UUID;

-- 6. Create an index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (email);

-- ============================================================
-- Example: insert an admin user with a bcrypt-hashed password.
-- Generate the hash outside the DB (e.g. using bcryptjs in Node):
--   const hash = await bcrypt.hash('YourPassword123!', 10)
-- Then run:
--   INSERT INTO user_profiles (full_name, email, password_hash, role, is_active)
--   VALUES ('Admin User', 'admin@example.com', '<hash>', 'admin', true);
-- ============================================================
