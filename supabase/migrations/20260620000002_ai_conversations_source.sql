-- Add source column to ai_conversations to distinguish cart orders from AI chat
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai';

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_ai_conversations_source
  ON public.ai_conversations (business_id, source);
