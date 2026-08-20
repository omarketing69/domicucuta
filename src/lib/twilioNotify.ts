import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type TwilioChannel = 'sms' | 'whatsapp_twilio' | 'voice' | 'email';

export const CHANNEL_META: Record<TwilioChannel, {
  label: string;
  description: string;
  cost: string;
  icon: string;
}> = {
  whatsapp_twilio: {
    label: 'WhatsApp (Twilio)',
    description: 'Envía mensajes WhatsApp sin configurar Meta Cloud API',
    cost: '~$0.005/mensaje',
    icon: '💬',
  },
  sms: {
    label: 'SMS',
    description: 'Notificaciones por texto a cualquier celular',
    cost: '~$0.008/mensaje',
    icon: '📱',
  },
  voice: {
    label: 'Llamadas de voz',
    description: 'Llama al cliente y reproduce un mensaje automático',
    cost: '~$0.014/minuto',
    icon: '📞',
  },
  email: {
    label: 'Email (SendGrid)',
    description: 'Envía confirmaciones y notificaciones por correo',
    cost: 'Gratis hasta 100/día',
    icon: '✉️',
  },
};

export async function sendTwilioNotification(opts: {
  businessId: string;
  to: string;
  channel: TwilioChannel;
  message: string;
  subject?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'No autenticado' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/twilio-notify`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      business_id: opts.businessId,
      to: opts.to,
      channel: opts.channel,
      message: opts.message,
      ...(opts.subject ? { subject: opts.subject } : {}),
    }),
  });

  const data = await res.json() as { success?: boolean; error?: string };
  if (!res.ok) return { success: false, error: data.error ?? 'Error al enviar' };
  return { success: true };
}
