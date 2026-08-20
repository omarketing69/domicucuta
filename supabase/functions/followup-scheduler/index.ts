/**
 * followup-scheduler — Supabase Edge Function v2
 *
 * Actions:
 *   evaluate      — (pg_cron) Evaluate active no_reply rules → create + send pending instances.
 *                   Triggers when: last message in conversation was OUTBOUND (business sent,
 *                   customer has not replied) and > delay_hours have elapsed.
 *   order_status  — (from Orders.tsx with user JWT) Find matching active rule for this
 *                   business + order status → create + send instance immediately.
 *   send_pending  — Process pending instances (flush queue).
 *
 * Auth:
 *   evaluate / send_pending: must be called with the service-role key (pg_cron / internal).
 *   order_status:            must be called with a valid user JWT that owns the business.
 *
 * POST body:
 *   { action?, business_id?, order_status?, phone?, name? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const META_API_VERSION = 'v19.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function interpolate(template: string, name: string | null | undefined): string {
  return template.replace(/\{\{nombre\}\}/gi, name ?? 'cliente');
}

async function sendWhatsApp(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string,
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
          text: { body: message },
        }),
      },
    );
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      console.warn('[followup-scheduler] Meta API error:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return (data.messages as Array<{ id: string }>)?.[0]?.id ?? null;
  } catch (e) {
    console.warn('[followup-scheduler] sendWhatsApp exception:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db          = createClient(supabaseUrl, serviceKey);

  const authHeader   = req.headers.get('Authorization') ?? '';
  const isServiceRole = authHeader === `Bearer ${serviceKey}`;

  // Resolve caller identity
  let userId: string | null = null;
  if (!isServiceRole) {
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized: bearer token required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    userId = user?.id ?? null;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok for evaluate */ }

  const action = (body.action as string) ?? 'evaluate';

  // ── evaluate and send_pending — service-role only (pg_cron / internal) ──────
  if (action === 'evaluate' || action === 'send_pending') {
    if (!isServiceRole) {
      return new Response(JSON.stringify({ error: 'Forbidden: service role required for evaluate/send_pending' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const targetBizId = (body.business_id as string) ?? null;
    let createdCount = 0;
    let sentCount    = 0;
    let failedCount  = 0;

    // Step 1 (evaluate only): create pending instances from active no_reply rules
    if (action === 'evaluate') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rulesQ: any = db
        .from('wa_followup_rules')
        .select('id, business_id, trigger_condition, delay_hours, message_template')
        .eq('trigger_event', 'no_reply')
        .eq('is_active', true);

      if (targetBizId) rulesQ = rulesQ.eq('business_id', targetBizId);

      const { data: rules } = await rulesQ;

      for (const rule of (rules ?? [])) {
        const hoursAgo     = new Date(Date.now() - rule.delay_hours * 3600_000).toISOString();
        const condition    = rule.trigger_condition as Record<string, string> | null;
        const intentFilter = condition?.intent ?? null;
        const statusFilter = condition?.contact_status ?? null; // wa_contacts.status filter

        // Find conversations where last_message_at is past the threshold (not resolved)
        const { data: conversations } = await db
          .from('wa_conversations')
          .select('id, contact_id, wa_contacts(id, phone, name, status)')
          .eq('business_id', rule.business_id)
          .lt('last_message_at', hoursAgo)
          .not('status', 'eq', 'resolved');

        for (const conv of (conversations ?? [])) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contact = (conv as any).wa_contacts as {
            id: string; phone: string; name: string | null; status: string | null;
          } | null;
          if (!contact?.phone) continue;

          // Filter by contact status (e.g., 'interested') if the rule specifies it
          if (statusFilter && contact.status !== statusFilter) continue;

          // No-reply semantics: the LAST message must be OUTBOUND (business → customer,
          // customer has NOT replied). If last message is inbound, customer already replied.
          const { data: lastMsg } = await db
            .from('wa_messages')
            .select('direction, intent')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Skip if last message was inbound (customer replied already)
          if (!lastMsg || lastMsg.direction !== 'outbound') continue;

          // Intent filter (based on the last inbound message intent, if we track it)
          // Since we look at outbound as the last msg, intent filter is on the rule only.
          // Honour intent filter if set — match against the conversation's latest inbound intent.
          if (intentFilter) {
            const { data: lastInbound } = await db
              .from('wa_messages')
              .select('intent')
              .eq('conversation_id', conv.id)
              .eq('direction', 'inbound')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (!lastInbound || lastInbound.intent !== intentFilter) continue;
          }

          // Check no instance already created for this rule + contact today
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const { data: existingInst } = await db
            .from('wa_followup_instances')
            .select('id')
            .eq('rule_id', rule.id)
            .eq('contact_id', conv.contact_id)
            .gte('created_at', todayStart.toISOString())
            .maybeSingle();

          if (existingInst) continue;

          // Create pending instance
          const interpolated = interpolate(rule.message_template, contact.name);
          await db.from('wa_followup_instances').insert({
            rule_id:      rule.id,
            business_id:  rule.business_id,
            contact_id:   conv.contact_id,
            phone:        contact.phone,
            name:         contact.name,
            message:      interpolated,
            scheduled_at: new Date().toISOString(),
            status:       'pending',
          });
          createdCount++;
        }
      }
    }

    // Step 2: send all pending instances (including those just created in Step 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingQ: any = db
      .from('wa_followup_instances')
      .select('id, business_id, phone, message, businesses(wa_phone_number_id, wa_access_token)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .limit(100);

    if (targetBizId) pendingQ = pendingQ.eq('business_id', targetBizId);

    const { data: pending } = await pendingQ;

    for (const inst of (pending ?? [])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const biz = (inst as any).businesses as {
        wa_phone_number_id: string | null; wa_access_token: string | null;
      } | null;
      const phoneNumberId = biz?.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
      const accessToken   = biz?.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

      if (!phoneNumberId || !accessToken) {
        await db.from('wa_followup_instances')
          .update({ status: 'failed', error_msg: 'WA credentials not configured' })
          .eq('id', inst.id);
        failedCount++;
        continue;
      }

      const waMessageId = await sendWhatsApp(phoneNumberId, accessToken, inst.phone, inst.message);

      if (waMessageId) {
        await db.from('wa_followup_instances').update({
          status:        'sent',
          wa_message_id: waMessageId,
          sent_at:       new Date().toISOString(),
        }).eq('id', inst.id);
        sentCount++;
      } else {
        await db.from('wa_followup_instances').update({
          status:    'failed',
          error_msg: 'Meta API send failed',
        }).eq('id', inst.id);
        failedCount++;
      }

      await sleep(200);
    }

    return new Response(JSON.stringify({ created: createdCount, sent: sentCount, failed: failedCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── order_status — user JWT required, must own the business ─────────────────
  if (action === 'order_status') {
    // userId is guaranteed non-null here (isServiceRole=false path verified above)
    const businessId  = body.business_id as string;
    const orderStatus = body.order_status as string;
    const phone       = body.phone as string;
    const name        = (body.name as string | null) ?? null;

    if (!businessId || !orderStatus || !phone) {
      return new Response(JSON.stringify({ error: 'Missing: business_id, order_status, phone' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership — user must own this business (or be admin)
    const { data: biz } = await db
      .from('businesses')
      .select('owner_id, wa_phone_number_id, wa_access_token')
      .eq('id', businessId)
      .maybeSingle();

    if (!biz) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (biz.owner_id !== userId) {
      const { data: roleData } = await db
        .from('user_roles').select('role').eq('user_id', userId!).eq('role', 'admin').maybeSingle();
      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Find active order_status rule matching this business + status
    const { data: rule } = await db
      .from('wa_followup_rules')
      .select('id, message_template')
      .eq('business_id', businessId)
      .eq('trigger_event', 'order_status')
      .eq('is_active', true)
      .filter('trigger_condition->>order_status', 'eq', orderStatus)
      .maybeSingle();

    if (!rule) {
      return new Response(JSON.stringify({ sent: false, reason: 'No active rule for this order status' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNumberId = biz.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
    const accessToken   = biz.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

    if (!phoneNumberId || !accessToken) {
      return new Response(JSON.stringify({ sent: false, reason: 'WhatsApp credentials not configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up contact (optional — used for FK)
    const { data: contact } = await db
      .from('wa_contacts')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();

    const interpolated = interpolate(rule.message_template, name);

    // Create instance record
    const { data: instance, error: instanceErr } = await db
      .from('wa_followup_instances')
      .insert({
        rule_id:      rule.id,
        business_id:  businessId,
        contact_id:   contact?.id ?? null,
        phone,
        name,
        message:      interpolated,
        scheduled_at: new Date().toISOString(),
        status:       'pending',
      })
      .select('id')
      .single();

    if (instanceErr || !instance) {
      return new Response(JSON.stringify({ sent: false, reason: 'Failed to create instance record' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send immediately
    const waMessageId = await sendWhatsApp(phoneNumberId, accessToken, phone, interpolated);

    if (waMessageId) {
      await db.from('wa_followup_instances').update({
        status:        'sent',
        wa_message_id: waMessageId,
        sent_at:       new Date().toISOString(),
      }).eq('id', instance.id);

      return new Response(JSON.stringify({ sent: true, instance_id: instance.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      await db.from('wa_followup_instances').update({
        status:    'failed',
        error_msg: 'Meta API send failed',
      }).eq('id', instance.id);

      return new Response(JSON.stringify({ sent: false, reason: 'Meta API send failed', instance_id: instance.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
