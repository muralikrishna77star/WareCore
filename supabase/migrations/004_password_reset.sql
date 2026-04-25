-- ============================================================
-- WareCore WMS - Password Reset Token Migration
-- Adds reset_token and reset_token_expires_at to user_profiles
-- for the forgot-password flow.
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS reset_token TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- Partial index for fast token lookups (only indexes non-null tokens)
CREATE INDEX IF NOT EXISTS idx_user_profiles_reset_token
  ON user_profiles (reset_token)
  WHERE reset_token IS NOT NULL;
