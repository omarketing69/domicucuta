/**
 * bulk-send — Supabase Edge Function v3
 *
 * Actions:
 *   send (default POST body):     Immediate broadcast — validates JWT + ownership, fetches
 *                                  ALL matching contacts (paginated, no hard limit), creates job,
 *                                  sends with 200ms rate limiting.
 *   process_scheduled (action param): Called by pg_cron — picks up pending scheduled jobs
 *                                  whose scheduled_at <= now() and processes them.
 *
 * POST body (send action):
 *   { business_id, name, message, filter: { type, value? } }
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function interpolate(template: string, name: string | null | undefined): string {
  return template.replace(/\{\{nombre\}\}/gi, name ?? 'cliente');
}

type Db = ReturnType<typeof createClient>;

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

// Send WhatsApp to one recipient — returns message ID or null on failure
async function sendOne(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
  } catch (e) {
    console.warn('[bulk-send] sendOne exception:', e);
    return null;
  }
}

// Process one job: send to contacts, update items + final job status
async function processJob(
  db: Db,
  jobId: string,
  businessId: string,
  message: string,
  contacts: Array<{ id: string; phone: string; name: string | null }>,
  phoneNumberId: string,
  accessToken: string,
): Promise<{ sent: number; failed: number }> {
  let sentCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    const personalizedMessage = interpolate(message, contact.name);
    const waMessageId = await sendOne(phoneNumberId, accessToken, contact.phone, personalizedMessage);

    if (waMessageId) {
      await db.from('wa_bulk_job_items').update({
        status: 'sent',
        wa_message_id: waMessageId,
        sent_at: new Date().toISOString(),
      }).eq('job_id', jobId).eq('contact_id', contact.id);
      sentCount++;
    } else {
      await db.from('wa_bulk_job_items').update({
        status: 'failed',
        error_msg: 'Meta API send failed',
      }).eq('job_id', jobId).eq('contact_id', contact.id);
      failedCount++;
    }

    await sleep(200); // 200ms between sends — well within Meta rate limits
  }

  await db.from('wa_bulk_jobs').update({
    status: failedCount > 0 && sentCount === 0 ? 'failed' : 'completed',
    sent_count: sentCount,
    failed_count: failedCount,
    completed_at: new Date().toISOString(),
  }).eq('id', jobId);

  return { sent: sentCount, failed: failedCount };
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
      .select('id, business_id, message, filter_type, filter_value, businesses(wa_phone_number_id, wa_access_token)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(10);

    let processed = 0;
    for (const job of (pendingJobs ?? [])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const biz = (job as any).businesses as { wa_phone_number_id: string | null; wa_access_token: string | null } | null;
      const phoneNumberId = biz?.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
      const accessToken   = biz?.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

      if (!phoneNumberId || !accessToken) {
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

      await processJob(db, job.id, job.business_id, job.message, contacts, phoneNumberId, accessToken);
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
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { business_id, name, message, filter } = body;
  if (!business_id || !name || !message || !filter?.type) {
    return new Response(JSON.stringify({ error: 'Missing: business_id, name, message, filter' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify business ownership
  const { data: business } = await db
    .from('businesses')
    .select('id, owner_id, wa_phone_number_id, wa_access_token')
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

  const phoneNumberId = business.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
  const accessToken   = business.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

  if (!phoneNumberId || !accessToken) {
    return new Response(JSON.stringify({ error: 'WhatsApp API not configured for this business.' }), {
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
    db, job.id, business_id, message, contacts, phoneNumberId, accessToken,
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
