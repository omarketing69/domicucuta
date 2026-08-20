-- Add ai_voice_lang column to businesses for per-restaurant TTS voice configuration
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_voice_lang text NOT NULL DEFAULT 'es-CO';

COMMENT ON COLUMN public.businesses.ai_voice_lang IS 'BCP47 language tag for the menu AI assistant TTS voice (e.g. es-CO, es-MX, en-US)';
