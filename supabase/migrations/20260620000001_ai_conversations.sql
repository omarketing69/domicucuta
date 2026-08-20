-- AI conversations table: logs every chat session from the public menu AI assistant
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug          TEXT        NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  messages      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  had_order     BOOLEAN     NOT NULL DEFAULT FALSE,
  order_data    JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_business ON public.ai_conversations (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_phone    ON public.ai_conversations (business_id, customer_phone) WHERE customer_phone IS NOT NULL;

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

-- Public menu (anon) can insert new conversations
CREATE POLICY "anon_insert_ai_conversations" ON public.ai_conversations
  FOR INSERT WITH CHECK (true);

-- Business owners can read their own conversations
CREATE POLICY "owner_select_ai_conversations" ON public.ai_conversations
  FOR SELECT USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- auto-update updated_at
CREATE TRIGGER ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
