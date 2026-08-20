import { supabase } from '@/integrations/supabase/client';

/**
 * Log an outbound WhatsApp message silently (fire-and-forget).
 * Never blocks the UI — errors are swallowed intentionally.
 */
export function logWaSent(
  businessId: string,
  phone: string,
  summary: string,
  metadata?: Record<string, unknown>
): void {
  const normalized = phone.replace(/\D/g, '');
  if (!normalized) return;
  supabase
    .from('customer_events')
    .insert({
      business_id:    businessId,
      customer_phone: normalized,
      channel:        'whatsapp',
      direction:      'outbound',
      summary,
      metadata:       metadata ?? {},
    })
    .then(() => {})
    .catch(() => {});
}

/**
 * Log a Twilio or other channel notification silently.
 */
export function logChannelEvent(
  businessId: string,
  phone: string,
  channel: 'twilio_sms' | 'twilio_voice' | 'email' | 'manual',
  summary: string,
  metadata?: Record<string, unknown>
): void {
  const normalized = phone.replace(/\D/g, '');
  if (!normalized) return;
  supabase
    .from('customer_events')
    .insert({
      business_id:    businessId,
      customer_phone: normalized,
      channel,
      direction:      'outbound',
      summary,
      metadata:       metadata ?? {},
    })
    .then(() => {})
    .catch(() => {});
}
