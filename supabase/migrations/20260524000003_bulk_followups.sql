-- ============================================================
-- Envío Masivo y Seguimientos Automáticos
-- wa_bulk_jobs: campaign / broadcast batch record
-- wa_bulk_job_items: per-recipient send status
-- wa_followup_rules: configurable auto-followup conditions
-- ============================================================

-- Bulk broadcast jobs
CREATE TABLE IF NOT EXISTS public.wa_bulk_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name           text NOT NULL,
  message        text NOT NULL,
  filter_type    text NOT NULL DEFAULT 'all'
                   CHECK (filter_type IN ('all','status','tags')),
  filter_value   text,                     -- status name or comma-separated tags
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sending','completed','failed')),
  total_count    integer NOT NULL DEFAULT 0,
  sent_count     integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  failed_count   integer NOT NULL DEFAULT 0,
  scheduled_at   timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_bulk_jobs_business ON public.wa_bulk_jobs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_bulk_jobs_status   ON public.wa_bulk_jobs(status);

-- Per-recipient items for each bulk job
CREATE TABLE IF NOT EXISTS public.wa_bulk_job_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES public.wa_bulk_jobs(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  name          text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','delivered','failed')),
  wa_message_id text,
  error_msg     text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_bulk_items_job      ON public.wa_bulk_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_wa_bulk_items_business ON public.wa_bulk_job_items(business_id);
CREATE INDEX IF NOT EXISTS idx_wa_bulk_items_status   ON public.wa_bulk_job_items(job_id, status);

-- Configurable auto-followup rules
CREATE TABLE IF NOT EXISTS public.wa_followup_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name               text NOT NULL,
  trigger_event      text NOT NULL
                       CHECK (trigger_event IN ('no_reply', 'order_status')),
  trigger_condition  jsonb NOT NULL DEFAULT '{}',
  -- no_reply example: {"intent": "order"}  or {} for any
  -- order_status example: {"status": "ready"}
  delay_hours        integer NOT NULL DEFAULT 24,
  message_template   text NOT NULL,   -- supports {{nombre}} placeholder
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_followup_rules_business ON public.wa_followup_rules(business_id);

-- Updated_at trigger for followup rules
DROP TRIGGER IF EXISTS trg_wa_followup_rules_updated_at ON public.wa_followup_rules;
CREATE TRIGGER trg_wa_followup_rules_updated_at
  BEFORE UPDATE ON public.wa_followup_rules
  FOR EACH ROW EXECUTE FUNCTION public.handle_wa_updated_at();  -- defined in migration 20260524000001

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.wa_bulk_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_bulk_job_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_followup_rules   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_bulk_jobs_owner"          ON public.wa_bulk_jobs;
DROP POLICY IF EXISTS "wa_bulk_jobs_service"         ON public.wa_bulk_jobs;
DROP POLICY IF EXISTS "wa_bulk_job_items_owner"      ON public.wa_bulk_job_items;
DROP POLICY IF EXISTS "wa_bulk_job_items_service"    ON public.wa_bulk_job_items;
DROP POLICY IF EXISTS "wa_followup_rules_owner"      ON public.wa_followup_rules;
DROP POLICY IF EXISTS "wa_followup_rules_service"    ON public.wa_followup_rules;

CREATE POLICY "wa_bulk_jobs_owner"
  ON public.wa_bulk_jobs FOR ALL
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

CREATE POLICY "wa_bulk_jobs_service"
  ON public.wa_bulk_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "wa_bulk_job_items_owner"
  ON public.wa_bulk_job_items FOR ALL
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

CREATE POLICY "wa_bulk_job_items_service"
  ON public.wa_bulk_job_items FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "wa_followup_rules_owner"
  ON public.wa_followup_rules FOR ALL
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

CREATE POLICY "wa_followup_rules_service"
  ON public.wa_followup_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
