/**
 * bulk-send — Supabase Edge Function v4
 *
 * Actions:
 *   send (default POST body):     Immediate broadcast — validates JWT + ownership, fetches
 *                                  ALL matching contacts (paginated, no hard limit), creates job,
 *                                  sends with 200ms rate limiting.
 *   process_scheduled (action param): Called by pg_cron — picks up pending scheduled jobs
 *                                  whose scheduled_at <= now() and processes them.
 *
 * POST body (send action):
 *   { business_id, name, message, filter: { type, value? }, channel? }
 *   channel: 'meta_whatsapp' (default, free) | 'twilio_whatsapp' | 'twilio_sms' (Pro only)
 *
 * POST body (process_scheduled action — service-role only):
 *   (no body required)
 *
 * Returns: { job_id?, total, sent, failed } or { processed: N }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const META_API_VERSION = 'v19.0';
const CONTACT_BATCH = 100; // fetch contacts in pages of 100

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type FilterType = 'all' | 'status' | 'tags';
type Channel = 'meta_whatsapp' | 'twilio_whatsapp' | 'twilio_sms';
const TWILIO_CHANNELS: Channel[] = ['twilio_whatsapp', 'twilio_sms'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function interpolate(template: string, name: string | null | undefined): string {
  return template.replace(/\{\{nombre\}\}/gi, name ?? 'cliente');
}

type Db = ReturnType<typeof createClient>;

interface SendCredentials {
  metaPhoneNumberId?: string | null;
  metaAccessToken?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioWhatsappNumber?: string | null;
  twilioSmsNumber?: string | null;
}

// A business is on the "pro" plan only while its plan is 'pro' AND (no
// expiry set, or the expiry hasn't passed yet) — same rule as
// src/lib/planUtils.ts's getEffectivePlan, replicated here since edge
// functions can't import frontend TS.
function isProPlan(business: { plan?: string | null; plan_expires_at?: string | null }): boolean {
  if (business.plan !== 'pro') return false;
  if (business.plan_expires_at && new Date(business.plan_expires_at) < new Date()) return false;
  return true;
}

// Fetch ALL matching contacts — paginated to avoid limit(200) hard cap
async function fetchAllContacts(
  db: Db,
  businessId: string,
  filterType: FilterType,
  filterValue: string | null | undefined,
): Promise<Array<{ id: string; phone: string; name: string | null }>> {
  const all: Array<{ id: string; phone: string; name: string | null }> = [];
  let start = 0;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db
      .from('wa_contacts')
      .select('id, phone, name')
      .eq('business_id', businessId)
      .not('phone', 'is', null)
      .range(start, start + CONTACT_BATCH - 1);

    if (filterType === 'status' && filterValue) {
      q = q.eq('status', filterValue);
    } else if (filterType === 'tags' && filterValue) {
      const tags = filterValue.split(',').map((t: string) => t.trim()).filter(Boolean);
      if (tags.length > 0) q = q.overlaps('tags', tags);
    }

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < CONTACT_BATCH) break; // last page
    start += CONTACT_BATCH;
  }

  return all;
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

// Send one message via the given channel — returns a provider message ID or null on failure
async function sendOne(
  channel: Channel,
  creds: SendCredentials,
  to: string,
  body: string,
): Promise<string | null> {
  try {
    if (channel === 'meta_whatsapp') {
      const res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${creds.metaPhoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.metaAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body },
          }),
        },
      );
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        console.warn('[bulk-send] Meta error:', JSON.stringify(data).slice(0, 200));
        return null;
      }
      return (data.messages as Array<{ id: string }>)?.[0]?.id ?? null;
    }

    // Twilio (WhatsApp or SMS) — same REST endpoint, different To/From formatting
    const isWhatsapp = channel === 'twilio_whatsapp';
    const from = isWhatsapp ? creds.twilioWhatsappNumber! : creds.twilioSmsNumber!;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.twilioAccountSid}/Messages.json`;
    const params = new URLSearchParams({
      To: isWhatsapp ? `whatsapp:${toE164(to)}` : toE164(to),
      From: isWhatsapp && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from,
      Body: body,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: twilioBasicAuth(creds.twilioAccountSid!, creds.twilioAuthToken!),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      console.warn('[bulk-send] Twilio error:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return (data.sid as string) ?? null;
  } catch (e) {
    console.warn('[bulk-send] sendOne exception:', e);
    return null;
  }
}

// Process one job: send to contacts, update items + final job status
async function processJob(
  db: Db,
  jobId: string,
  channel: Channel,
  message: string,
  contacts: Array<{ id: string; phone: string; name: string | null }>,
  creds: SendCredentials,
): Promise<{ sent: number; failed: number }> {
  let sentCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    const personalizedMessage = interpolate(message, contact.name);
    const messageId = await sendOne(channel, creds, contact.phone, personalizedMessage);

    if (messageId) {
      await db.from('wa_bulk_job_items').update({
        status: 'sent',
        wa_message_id: messageId,
        sent_at: new Date().toISOString(),
      }).eq('job_id', jobId).eq('contact_id', contact.id);
      sentCount++;
    } else {
      await db.from('wa_bulk_job_items').update({
        status: 'failed',
        error_msg: `${channel} send failed`,
      }).eq('job_id', jobId).eq('contact_id', contact.id);
      failedCount++;
    }

    await sleep(200); // 200ms between sends — well within Meta/Twilio rate limits
  }

  await db.from('wa_bulk_jobs').update({
    status: failedCount > 0 && sentCount === 0 ? 'failed' : 'completed',
    sent_count: sentCount,
    failed_count: failedCount,
    completed_at: new Date().toISOString(),
  }).eq('id', jobId);

  return { sent: sentCount, failed: failedCount };
}

// Resolves send credentials for a channel, or an error message if misconfigured/not allowed
function resolveCredentials(
  channel: Channel,
  business: {
    plan?: string | null; plan_expires_at?: string | null;
    wa_phone_number_id?: string | null; wa_access_token?: string | null;
    twilio_account_sid?: string | null; twilio_auth_token?: string | null;
    twilio_whatsapp_number?: string | null; twilio_sms_number?: string | null;
  },
): { creds: SendCredentials | null; error: string | null } {
  if (TWILIO_CHANNELS.includes(channel) && !isProPlan(business)) {
    return { creds: null, error: 'El envío masivo por Twilio requiere el Plan Pro.' };
  }

  if (channel === 'meta_whatsapp') {
    const metaPhoneNumberId = business.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
    const metaAccessToken   = business.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');
    if (!metaPhoneNumberId || !metaAccessToken) {
      return { creds: null, error: 'WhatsApp API not configured for this business.' };
    }
    return { creds: { metaPhoneNumberId, metaAccessToken }, error: null };
  }

  if (!business.twilio_account_sid || !business.twilio_auth_token) {
    return { creds: null, error: 'Credenciales de Twilio no configuradas para este negocio.' };
  }
  if (channel === 'twilio_whatsapp' && !business.twilio_whatsapp_number) {
    return { creds: null, error: 'Número de WhatsApp de Twilio no configurado.' };
  }
  if (channel === 'twilio_sms' && !business.twilio_sms_number) {
    return { creds: null, error: 'Número de SMS de Twilio no configurado.' };
  }
  return {
    creds: {
      twilioAccountSid: business.twilio_account_sid,
      twilioAuthToken: business.twilio_auth_token,
      twilioWhatsappNumber: business.twilio_whatsapp_number,
      twilioSmsNumber: business.twilio_sms_number,
    },
    error: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db             = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader === `Bearer ${serviceKey}`;

  // ── action=process_scheduled — service-role only (pg_cron) ──────────────────
  const url = new URL(req.url);
  if (url.searchParams.get('action') === 'process_scheduled') {
    if (!isServiceRole) {
      return new Response(JSON.stringify({ error: 'Unauthorized: service role required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch up to 10 pending scheduled jobs whose scheduled_at is in the past
    const { data: pendingJobs } = await db
      .from('wa_bulk_jobs')
      .select('id, business_id, message, filter_type, filter_value, channel, businesses(plan, plan_expires_at, wa_phone_number_id, wa_access_token, twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, twilio_sms_number)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(10);

    let processed = 0;
    for (const job of (pendingJobs ?? [])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const biz = (job as any).businesses as Record<string, unknown> | null;
      const channel = ((job as any).channel as Channel) ?? 'meta_whatsapp';
      const { creds, error } = resolveCredentials(channel, biz ?? {});

      if (!creds) {
        console.warn('[bulk-send] scheduled job', job.id, 'skipped:', error);
        await db.from('wa_bulk_jobs').update({ status: 'failed', failed_count: 0 }).eq('id', job.id);
        continue;
      }

      // Mark as sending
      await db.from('wa_bulk_jobs').update({ status: 'sending' }).eq('id', job.id);

      // Fetch contacts matching this job's filter
      const contacts = await fetchAllContacts(db, job.business_id, job.filter_type as FilterType, job.filter_value);

      if (contacts.length === 0) {
        await db.from('wa_bulk_jobs').update({ status: 'completed', sent_count: 0, failed_count: 0, completed_at: new Date().toISOString() }).eq('id', job.id);
        continue;
      }

      // Ensure job items exist (they may not for jobs created directly in DB from UI)
      await db.from('wa_bulk_job_items').insert(
        contacts.map(c => ({
          job_id:      job.id,
          business_id: job.business_id,
          contact_id:  c.id,
          phone:       c.phone,
          name:        c.name,
          status:      'pending',
        }))
      );
      await db.from('wa_bulk_jobs').update({ total_count: contacts.length }).eq('id', job.id);

      await processJob(db, job.id, channel, job.message, contacts, creds);
      processed++;
    }

    return new Response(JSON.stringify({ processed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── action=send (default) — user JWT required ────────────────────────────────

  // Require a valid JWT (user, not service role)
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await anonClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let body: {
    business_id: string;
    name: string;
    message: string;
    filter: { type: FilterType; value?: string };
    channel?: Channel;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { business_id, name, message, filter } = body;
  const channel: Channel = body.channel ?? 'meta_whatsapp';
  if (!business_id || !name || !message || !filter?.type) {
    return new Response(JSON.stringify({ error: 'Missing: business_id, name, message, filter' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify business ownership
  const { data: business } = await db
    .from('businesses')
    .select('id, owner_id, plan, plan_expires_at, wa_phone_number_id, wa_access_token, twilio_account_sid, twilio_auth_token, twilio_whatsapp_number, twilio_sms_number')
    .eq('id', business_id)
    .maybeSingle();

  if (!business) {
    return new Response(JSON.stringify({ error: 'Business not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (business.owner_id !== user.id) {
    const { data: roleData } = await db
      .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const { creds, error: credsError } = resolveCredentials(channel, business);
  if (!creds) {
    return new Response(JSON.stringify({ error: credsError }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Fetch ALL matching contacts (paginated — no hard limit)
  const contacts = await fetchAllContacts(db, business_id, filter.type, filter.value);

  if (contacts.length === 0) {
    return new Response(JSON.stringify({ error: 'No contacts match the filter criteria.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create bulk job
  const { data: job, error: jobErr } = await db
    .from('wa_bulk_jobs')
    .insert({
      business_id,
      name,
      message,
      filter_type:  filter.type,
      filter_value: filter.value ?? null,
      channel,
      status:       'sending',
      total_count:  contacts.length,
    })
    .select('id')
    .single();

  if (jobErr || !job) {
    return new Response(JSON.stringify({ error: 'Failed to create bulk job' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create job items (all recipients, pending)
  await db.from('wa_bulk_job_items').insert(
    contacts.map(c => ({
      job_id:      job.id,
      business_id,
      contact_id:  c.id,
      phone:       c.phone,
      name:        c.name,
      status:      'pending',
    }))
  );

  // Process all sends
  const { sent: sentCount, failed: failedCount } = await processJob(
    db, job.id, channel, message, contacts, creds,
  );

  return new Response(JSON.stringify({
    success: true,
    job_id:  job.id,
    total:   contacts.length,
    sent:    sentCount,
    failed:  failedCount,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
