-- ============================================================
-- WareCore WMS - Auth Schema Stub
-- Creates a minimal auth schema so that migrations 001 and 002
-- (originally written for Supabase) run on plain Postgres.
-- Runs FIRST because it is named 000_*.
-- ============================================================

-- Create the auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Stub users table so user_profiles FK works during migration 001
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Stub auth.uid() to return NULL — policies that call this will be
-- no-ops, which is fine because Hasura enforces access control
-- through its own permission layer (admin secret + JWT roles).
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULL::UUID
$$;
