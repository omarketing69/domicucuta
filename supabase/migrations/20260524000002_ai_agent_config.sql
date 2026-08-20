-- ============================================================
-- AI Agent configuration fields for businesses
-- Enables per-business AI auto-reply + classification settings
-- ============================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_prompt          text,
  ADD COLUMN IF NOT EXISTS ai_auto_reply_mode text NOT NULL DEFAULT 'disabled'
    CHECK (ai_auto_reply_mode IN ('always', 'off_hours', 'disabled'));
