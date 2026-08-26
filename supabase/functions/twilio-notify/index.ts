import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TwilioChannel = 'sms' | 'whatsapp_twilio' | 'voice' | 'email';

interface NotifyRequest {
  business_id: string;
  to: string;
  channel: TwilioChannel;
  message: string;
}

function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  if (!digits.startsWith('+')) return `+${digits}`;
  return phone;
}

function twilioBasicAuth(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

async function sendTwilioSms(opts: {
  accountSid: string; authToken: string;
  from: string; to: string; body: string;
}) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: toE164(opts.to),
    From: opts.from,
    Body: opts.body,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': twilioBasicAuth(opts.accountSid, opts.authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Twilio SMS error: ${JSON.stringify(data)}`);
  return data;
}

async function sendTwilioWhatsApp(opts: {
  accountSid: string; authToken: string;
  from: string; to: string; body: string;
}) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`;
  const waTo = `whatsapp:${toE164(opts.to)}`;
  const waFrom = opts.from.startsWith('whatsapp:') ? opts.from : `whatsapp:${opts.from}`;
  const params = new URLSearchParams({ To: waTo, From: waFrom, Body: opts.body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': twilioBasicAuth(opts.accountSid, opts.authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Twilio WhatsApp error: ${JSON.stringify(data)}`);
  return data;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function sendTwilioVoice(opts: {
  accountSid: string; authToken: string;
  from: string; to: string; message: string;
}) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`;
  const twiml = `<Response><Say language="es-MX" voice="alice">${escapeXml(opts.message)}</Say></Response>`;
  const params = new URLSearchParams({
    To: toE164(opts.to),
    From: opts.from,
    Twiml: twiml,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': twilioBasicAuth(opts.accountSid, opts.authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Twilio Voice error: ${JSON.stringify(data)}`);
  return data;
}

async function sendSendGridEmail(opts: {
  apiKey: string; from: string; to: string;
  subject: string; text: string;
}) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: { email: opts.from, name: 'WhatOrden' },
      subject: opts.subject,
      content: [{ type: 'text/plain', value: opts.text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
  return { success: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await anonClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: NotifyRequest;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { business_id, to, channel, message } = body;
  if (!business_id || !to || !channel || !message) {
    return new Response(JSON.stringify({ error: 'Missing required fields: business_id, to, channel, message' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: business, error: bizErr } = await db
      .from('businesses')
      .select('id, owner_id, plan, plan_expires_at, twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, twilio_sms_number, twilio_voice_number, sendgrid_api_key, sendgrid_from_email, enabled_channels')
      .eq('id', business_id)
      .maybeSingle();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (business.owner_id !== user.id) {
      const { data: roleData } = await db.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const isPro = business.plan === 'pro' &&
      !(business.plan_expires_at && new Date(business.plan_expires_at) < new Date());
    if (!isPro) {
      return new Response(JSON.stringify({ error: 'Twilio requiere el Plan Pro' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const enabledChannels: string[] = business.enabled_channels ?? [];
    if (!enabledChannels.includes(channel)) {
      return new Response(JSON.stringify({ error: `Channel '${channel}' is not enabled for this business` }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { twilio_account_sid: sid, twilio_auth_token: token } = business;

    let result: unknown;

    if (channel === 'sms') {
      if (!sid || !token || !business.twilio_sms_number) throw new Error('SMS credentials not configured');
      result = await sendTwilioSms({ accountSid: sid, authToken: token, from: business.twilio_sms_number, to, body: message });
    } else if (channel === 'whatsapp_twilio') {
      if (!sid || !token || !business.twilio_whatsapp_number) throw new Error('WhatsApp Twilio credentials not configured');
      result = await sendTwilioWhatsApp({ accountSid: sid, authToken: token, from: business.twilio_whatsapp_number, to, body: message });
    } else if (channel === 'voice') {
      if (!sid || !token || !business.twilio_voice_number) throw new Error('Voice credentials not configured');
      result = await sendTwilioVoice({ accountSid: sid, authToken: token, from: business.twilio_voice_number, to, message });
    } else if (channel === 'email') {
      if (!business.sendgrid_api_key || !business.sendgrid_from_email) throw new Error('Email credentials not configured');
      const emailSubject = (body.subject as string | undefined) || 'Notificación de WhatOrden';
      result = await sendSendGridEmail({
        apiKey: business.sendgrid_api_key,
        from: business.sendgrid_from_email,
        to,
        subject: emailSubject,
        text: message,
      });
    } else {
      return new Response(JSON.stringify({ error: `Unknown channel: ${channel}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('[twilio-notify] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
