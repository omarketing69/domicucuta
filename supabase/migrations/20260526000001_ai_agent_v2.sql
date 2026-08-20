-- ============================================================
-- AI Agent v2: flow nodes, knowledge base, handoff, operating hours
-- ============================================================

-- ── 1. New business AI fields ──────────────────────────────────────────────────

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_model            text NOT NULL DEFAULT 'openai/gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS ai_operating_hours  jsonb,
  ADD COLUMN IF NOT EXISTS ai_knowledge_base   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_handoff_keywords text[] DEFAULT '{}';

-- ── 2. Flow nodes table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_flow_nodes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text NOT NULL,
  trigger_keywords  text[] NOT NULL DEFAULT '{}',
  trigger_intent    text CHECK (trigger_intent IN ('order','inquiry','complaint','follow_up','other') OR trigger_intent IS NULL),
  response_template text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_flow_nodes_business
  ON public.ai_flow_nodes(business_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_ai_flow_nodes_active
  ON public.ai_flow_nodes(business_id, is_active);

ALTER TABLE public.ai_flow_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_flow_nodes_owner"   ON public.ai_flow_nodes;
DROP POLICY IF EXISTS "ai_flow_nodes_service" ON public.ai_flow_nodes;

CREATE POLICY "ai_flow_nodes_owner"
  ON public.ai_flow_nodes FOR ALL
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "ai_flow_nodes_service"
  ON public.ai_flow_nodes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.handle_ai_flow_nodes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_ai_flow_nodes_updated_at ON public.ai_flow_nodes;
CREATE TRIGGER trg_ai_flow_nodes_updated_at
  BEFORE UPDATE ON public.ai_flow_nodes
  FOR EACH ROW EXECUTE FUNCTION public.handle_ai_flow_nodes_updated_at();

-- ── 3. Conversation handoff fields ────────────────────────────────────────────

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS needs_human  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flow_node_id uuid REFERENCES public.ai_flow_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_conversations_needs_human
  ON public.wa_conversations(business_id, needs_human)
  WHERE needs_human = true;
