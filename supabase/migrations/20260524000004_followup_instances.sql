-- ============================================================
-- wa_followup_instances: persisted follow-up message records
-- Each instance = one scheduled/sent/canceled follow-up per contact
-- Created by followup-scheduler when evaluating rules
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wa_followup_instances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid REFERENCES public.wa_followup_rules(id) ON DELETE SET NULL,
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  name          text,
  message       text NOT NULL,
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','canceled','failed')),
  sent_at       timestamptz,
  wa_message_id text,
  error_msg     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_followup_inst_business ON public.wa_followup_instances(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_followup_inst_status   ON public.wa_followup_instances(business_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_followup_inst_rule     ON public.wa_followup_instances(rule_id);
CREATE INDEX IF NOT EXISTS idx_wa_followup_inst_pending  ON public.wa_followup_instances(status, scheduled_at)
  WHERE status = 'pending';

ALTER TABLE public.wa_followup_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_followup_instances_owner"   ON public.wa_followup_instances;
DROP POLICY IF EXISTS "wa_followup_instances_service" ON public.wa_followup_instances;

CREATE POLICY "wa_followup_instances_owner"
  ON public.wa_followup_instances FOR ALL
  USING (business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid()));

CREATE POLICY "wa_followup_instances_service"
  ON public.wa_followup_instances FOR ALL TO service_role USING (true) WITH CHECK (true);
