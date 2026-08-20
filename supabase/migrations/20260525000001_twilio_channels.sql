-- ============================================================
-- Twilio multi-channel integration
-- Adds Twilio + SendGrid credential columns to businesses
-- and an enabled_channels array for per-business opt-in
-- ============================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS twilio_account_sid     TEXT,
  ADD COLUMN IF NOT EXISTS twilio_auth_token      TEXT,
  ADD COLUMN IF NOT EXISTS twilio_whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS twilio_sms_number      TEXT,
  ADD COLUMN IF NOT EXISTS twilio_voice_number    TEXT,
  ADD COLUMN IF NOT EXISTS sendgrid_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS sendgrid_from_email    TEXT,
  ADD COLUMN IF NOT EXISTS enabled_channels       TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.businesses.twilio_account_sid     IS 'Twilio Account SID (shared by WA/SMS/Voice)';
COMMENT ON COLUMN public.businesses.twilio_auth_token      IS 'Twilio Auth Token';
COMMENT ON COLUMN public.businesses.twilio_whatsapp_number IS 'Twilio WhatsApp-enabled number in E.164';
COMMENT ON COLUMN public.businesses.twilio_sms_number      IS 'Twilio SMS number in E.164';
COMMENT ON COLUMN public.businesses.twilio_voice_number    IS 'Twilio Voice number in E.164';
COMMENT ON COLUMN public.businesses.sendgrid_api_key       IS 'SendGrid API key for email channel';
COMMENT ON COLUMN public.businesses.sendgrid_from_email    IS 'Verified sender email for SendGrid';
COMMENT ON COLUMN public.businesses.enabled_channels       IS 'Active Twilio channels: sms, whatsapp_twilio, voice, email';
