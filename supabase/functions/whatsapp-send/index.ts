import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_API_VERSION = 'v19.0';

interface SendRequest {
  to: string;           // E.164 phone number, e.g. "573001234567"
  message: string;      // Plain text message
  business_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── 1. Validate the caller's JWT ─────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify token with Supabase — rejects forged / expired tokens
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

  // ── 2. Parse and validate body ────────────────────────────────────────────
  let body: SendRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { to, message, business_id } = body;
  if (!to || !message || !business_id) {
    return new Response(JSON.stringify({ error: 'Missing required fields: to, message, business_id' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Service role client — only used after ownership verification below
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 3. Verify caller owns this business (tenant boundary check) ───────
    const { data: business, error: bizErr } = await db
      .from('businesses')
      .select('id, owner_id, wa_phone_number_id, wa_access_token')
      .eq('id', business_id)
      .maybeSingle();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only the owner may send on behalf of this business, unless the caller is superadmin
    if (business.owner_id !== user.id) {
      const { data: roleData } = await db
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (!roleData) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── 4. Resolve WhatsApp credentials ───────────────────────────────────
    // Priority: per-business DB credentials → global fallback secrets.
    // Multi-tenant SaaS: each business configures its own WhatsApp account.
    // Global secrets (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID) serve as fallback
    // for businesses that have not yet set up their own credentials.
    const phoneNumberId = business.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
    const accessToken   = business.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

    if (!phoneNumberId || !accessToken) {
      return new Response(JSON.stringify({
        error: 'WhatsApp API not configured. Set wa_phone_number_id and wa_access_token in Business Settings, or configure WHATSAPP_PHONE_ID and WHATSAPP_TOKEN global secrets.',
      }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 5. Call Meta Graph API ────────────────────────────────────────────
    const metaRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        }),
      }
    );

    const metaData = await metaRes.json() as Record<string, unknown>;

    if (!metaRes.ok) {
      console.error('[whatsapp-send] Meta API error:', JSON.stringify(metaData));
      return new Response(JSON.stringify({ error: 'Meta API error', details: metaData }), {
        status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const waMessageId = (metaData.messages as Array<{ id: string }>)?.[0]?.id ?? null;

    // ── 6. Persist outbound message ───────────────────────────────────────
    const { data: contact } = await db
      .from('wa_contacts')
      .select('id')
      .eq('business_id', business_id)
      .eq('phone', to)
      .maybeSingle();

    let contactId = contact?.id;

    if (!contactId) {
      const { data: newContact } = await db
        .from('wa_contacts')
        .insert({ business_id, phone: to, name: to, last_interaction_at: new Date().toISOString() })
        .select('id')
        .single();
      contactId = newContact!.id;
    }

    const { data: conv } = await db
      .from('wa_conversations')
      .select('id')
      .eq('business_id', business_id)
      .eq('contact_id', contactId)
      .maybeSingle();

    let convId = conv?.id;

    if (!convId) {
      const { data: newConv } = await db
        .from('wa_conversations')
        .insert({
          business_id,
          contact_id: contactId,
          status: 'open',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      convId = newConv!.id;
    } else {
      await db.from('wa_conversations').update({
        last_message_at: new Date().toISOString(),
        status: 'open',
      }).eq('id', convId);
    }

    await db.from('wa_messages').insert({
      business_id,
      conversation_id: convId,
      contact_id: contactId,
      wa_message_id: waMessageId,
      direction: 'outbound',
      type: 'text',
      content: message,
      status: 'sent',
      wa_timestamp: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true, wa_message_id: waMessageId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[whatsapp-send] error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
