-- ============================================================
-- WareCore WMS - AI Copilot conversation persistence
--
-- Phase A of the AI Copilot upgrade: real DB-backed chat history
-- (previously in-memory only, reset on panel close). One row per
-- thread in ai_conversations, one row per turn in ai_messages.
-- created_by references user_profiles (the live app-auth user
-- table), not the stale auth.users Supabase stub already stripped
-- from other tables' created_by columns (see migrations 049/050).
-- ============================================================

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_conversations_owner ON ai_conversations(created_by, updated_at DESC);

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  ledger JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, created_at);
