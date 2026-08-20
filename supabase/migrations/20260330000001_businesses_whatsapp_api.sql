-- Add WhatsApp Business API credential columns to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS wa_phone_number_id text,
  ADD COLUMN IF NOT EXISTS wa_access_token text;
