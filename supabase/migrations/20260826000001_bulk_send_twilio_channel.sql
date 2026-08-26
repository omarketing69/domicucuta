-- ============================================================
-- Migration: Twilio channel for bulk broadcasts
--
-- wa_bulk_jobs only ever sent through the business's own Meta WhatsApp
-- number. Adds a `channel` column so the same job/scheduling/history
-- infrastructure can also send through Twilio (WhatsApp or SMS) — the
-- paid-tier BSP path. Defaults to 'meta_whatsapp' so every existing row
-- and every existing caller that doesn't pass a channel keeps working
-- unchanged.
-- ============================================================

ALTER TABLE public.wa_bulk_jobs
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'meta_whatsapp'
    CHECK (channel IN ('meta_whatsapp', 'twilio_whatsapp', 'twilio_sms'));
