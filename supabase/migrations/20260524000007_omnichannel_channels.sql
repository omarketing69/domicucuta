-- ============================================================
-- Omnichannel support: Instagram DM + Facebook Messenger
-- ============================================================
-- Adds `channel` column to wa_contacts, wa_conversations, wa_messages.
-- Adds `external_id` (PSID) to wa_contacts for non-WA contacts.
-- Makes phone nullable (IG/Messenger contacts identified by PSID).
-- Fixes UNIQUE constraints to be channel-aware.
-- Adds ig_page_id, ig_access_token, fb_page_id, fb_page_token to businesses.
-- ============================================================

-- ── 1. Add channel columns ─────────────────────────────────────────────────────

ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger'));

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger'));

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp','instagram','messenger'));

-- ── 2. Add external_id to wa_contacts (PSID for Instagram/Messenger) ──────────

ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS external_id text;

-- ── 3. Make phone nullable (IG/Messenger contacts don't have phones) ──────────

ALTER TABLE public.wa_contacts ALTER COLUMN phone DROP NOT NULL;

-- ── 4. Drop old unique constraints (they are now channel-scoped) ──────────────

ALTER TABLE public.wa_contacts
  DROP CONSTRAINT IF EXISTS wa_contacts_business_id_phone_key;

ALTER TABLE public.wa_conversations
  DROP CONSTRAINT IF EXISTS wa_conversations_business_id_contact_id_key;

-- ── 5. New channel-aware unique indexes ───────────────────────────────────────

-- WhatsApp contacts are unique by (business, phone) within the WA channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_contacts_phone_unique
  ON public.wa_contacts(business_id, phone)
  WHERE phone IS NOT NULL AND channel = 'whatsapp';

-- Instagram/Messenger contacts are unique by (business, external_id, channel)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_contacts_extid_unique
  ON public.wa_contacts(business_id, external_id, channel)
  WHERE external_id IS NOT NULL;

-- Conversations are unique per (business, contact, channel)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conversations_channel_unique
  ON public.wa_conversations(business_id, contact_id, channel);

-- ── 6. Add IG/FB credentials to businesses ────────────────────────────────────

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ig_page_id    text,
  ADD COLUMN IF NOT EXISTS ig_access_token text,
  ADD COLUMN IF NOT EXISTS fb_page_id    text,
  ADD COLUMN IF NOT EXISTS fb_page_token text;

-- ── 7. Indexes for business lookup by IG/FB page ID ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_businesses_ig_page_id
  ON public.businesses(ig_page_id)
  WHERE ig_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_fb_page_id
  ON public.businesses(fb_page_id)
  WHERE fb_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_messages_channel
  ON public.wa_messages(business_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_channel
  ON public.wa_conversations(business_id, channel);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_channel
  ON public.wa_contacts(business_id, channel);
