-- ============================================================
-- WhatsApp CRM Tables (idempotent)
-- wa_contacts: leads/contacts per business
-- wa_conversations: grouped conversation threads
-- wa_messages: individual messages (inbound & outbound)
-- ============================================================

-- Contacts / Leads
CREATE TABLE IF NOT EXISTS public.wa_contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone               text NOT NULL,
  name                text,
  status              text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new','contacted','interested','customer','recurring')),
  tags                text[] DEFAULT '{}',
  score               integer NOT NULL DEFAULT 0,
  notes               text,
  last_interaction_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_business ON public.wa_contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone    ON public.wa_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_status   ON public.wa_contacts(business_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_tags     ON public.wa_contacts USING gin(tags);

-- Conversations (one per contact per business thread)
CREATE TABLE IF NOT EXISTS public.wa_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','pending','resolved')),
  unread_count    integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_business ON public.wa_conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_contact  ON public.wa_conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_status   ON public.wa_conversations(business_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_last_msg ON public.wa_conversations(business_id, last_message_at DESC);

-- Messages
CREATE TABLE IF NOT EXISTS public.wa_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  wa_message_id  text UNIQUE,
  direction      text NOT NULL CHECK (direction IN ('inbound','outbound')),
  type           text NOT NULL DEFAULT 'text'
                   CHECK (type IN ('text','image','audio','video','document','location','sticker','reaction','unknown')),
  content        text,
  media_url      text,
  intent         text CHECK (intent IN ('order','inquiry','complaint','follow_up','other')),
  sent_by_ai     boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent','delivered','read','failed')),
  wa_timestamp   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON public.wa_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_business     ON public.wa_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_contact      ON public.wa_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_wa_id        ON public.wa_messages(wa_message_id);

-- ---- RLS ----
ALTER TABLE public.wa_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages     ENABLE ROW LEVEL SECURITY;

-- Policies (drop first for idempotency)
DROP POLICY IF EXISTS "wa_contacts_owner"       ON public.wa_contacts;
DROP POLICY IF EXISTS "wa_contacts_service"     ON public.wa_contacts;
DROP POLICY IF EXISTS "wa_conversations_owner"  ON public.wa_conversations;
DROP POLICY IF EXISTS "wa_conversations_service" ON public.wa_conversations;
DROP POLICY IF EXISTS "wa_messages_owner"       ON public.wa_messages;
DROP POLICY IF EXISTS "wa_messages_service"     ON public.wa_messages;

-- Owners can read/write their own business data
CREATE POLICY "wa_contacts_owner"
  ON public.wa_contacts FOR ALL
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "wa_conversations_owner"
  ON public.wa_conversations FOR ALL
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "wa_messages_owner"
  ON public.wa_messages FOR ALL
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

-- Service role bypass (for Edge Functions)
CREATE POLICY "wa_contacts_service"
  ON public.wa_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "wa_conversations_service"
  ON public.wa_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "wa_messages_service"
  ON public.wa_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION public.handle_wa_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_wa_contacts_updated_at     ON public.wa_contacts;
DROP TRIGGER IF EXISTS trg_wa_conversations_updated_at ON public.wa_conversations;

CREATE TRIGGER trg_wa_contacts_updated_at
  BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_wa_updated_at();

CREATE TRIGGER trg_wa_conversations_updated_at
  BEFORE UPDATE ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_wa_updated_at();
