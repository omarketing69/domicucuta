/**
 * meta-send — Supabase Edge Function
 * Unified message sender for WhatsApp, Instagram DM, and Facebook Messenger.
 *
 * POST body:
 *   channel:     'whatsapp' | 'instagram' | 'messenger'
 *   recipient_id: phone (WA) or PSID (IG/Messenger)
 *   message:      plain text
 *   business_id:  uuid
 *   conversation_id: uuid  (to persist the outbound message)
 *   contact_id:   uuid     (to persist the outbound message)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const META_API_VERSION = 'v19.0';

type Channel = 'whatsapp' | 'instagram' | 'messenger';

interface SendRequest {
  channel: Channel;
  recipient_id: string;
  message: string;
  business_id: string;
  conversation_id: string;
  contact_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
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

  // ── Body ─────────────────────────────────────────────────────────────────
  let body: SendRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { channel, recipient_id, message, business_id, conversation_id, contact_id } = body;
  if (!channel || !recipient_id || !message || !business_id || !conversation_id || !contact_id) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Tenant boundary check ───────────────────────────────────────────
    const { data: business, error: bizErr } = await db.from('businesses')
      .select('id, owner_id, wa_phone_number_id, wa_access_token, ig_page_id, ig_access_token, fb_page_id, fb_page_token')
      .eq('id', business_id)
      .maybeSingle();

    if (bizErr || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (business.owner_id !== user.id) {
      // Only platform superadmins (role='admin', not business-scoped) may send on behalf of any business
      const { data: superadminRole } = await db.from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .is('business_id', null)   // platform-level role has no business_id scope
        .maybeSingle();
      if (!superadminRole) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Cross-tenant integrity: validate conversation + contact belong to this business ─
    const [convResult, contactResult] = await Promise.all([
      db.from('wa_conversations')
        .select('id, business_id, contact_id, channel')
        .eq('id', conversation_id)
        .maybeSingle(),
      db.from('wa_contacts')
        .select('id, business_id')
        .eq('id', contact_id)
        .maybeSingle(),
    ]);

    if (!convResult.data || convResult.data.business_id !== business_id) {
      return new Response(JSON.stringify({ error: 'Forbidden: conversation does not belong to this business' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!contactResult.data || contactResult.data.business_id !== business_id) {
      return new Response(JSON.stringify({ error: 'Forbidden: contact does not belong to this business' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (convResult.data.contact_id !== contact_id) {
      return new Response(JSON.stringify({ error: 'Forbidden: contact_id does not match conversation' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (convResult.data.channel !== channel) {
      return new Response(JSON.stringify({ error: 'Forbidden: channel mismatch with conversation' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Route by channel ────────────────────────────────────────────────
    let metaMessageId: string | null = null;

    if (channel === 'whatsapp') {
      const phoneNumberId = business.wa_phone_number_id ?? Deno.env.get('WHATSAPP_PHONE_ID');
      const accessToken   = business.wa_access_token   ?? Deno.env.get('WHATSAPP_TOKEN');

      if (!phoneNumberId || !accessToken) {
        return new Response(JSON.stringify({ error: 'WhatsApp API not configured' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipient_id,
            type: 'text',
            text: { body: message },
          }),
        },
      );
      const metaData = await metaRes.json() as Record<string, unknown>;
      if (!metaRes.ok) {
        return new Response(JSON.stringify({ error: 'Meta API error', details: metaData }), {
          status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      metaMessageId = (metaData.messages as Array<{ id: string }>)?.[0]?.id ?? null;

    } else if (channel === 'instagram') {
      const igPageId = business.ig_page_id;
      const igToken  = business.ig_access_token;

      if (!igPageId || !igToken) {
        return new Response(JSON.stringify({ error: 'Instagram API not configured. Set ig_page_id and ig_access_token in Configuración → Canales.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${igPageId}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${igToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
          }),
        },
      );
      const metaData = await metaRes.json() as Record<string, unknown>;
      if (!metaRes.ok) {
        return new Response(JSON.stringify({ error: 'Instagram API error', details: metaData }), {
          status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      metaMessageId = (metaData as { message_id?: string }).message_id ?? null;

    } else if (channel === 'messenger') {
      const fbPageId  = business.fb_page_id;
      const fbToken   = business.fb_page_token;

      if (!fbPageId || !fbToken) {
        return new Response(JSON.stringify({ error: 'Messenger API not configured. Set fb_page_id and fb_page_token in Configuración → Canales.' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const metaRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/me/messages?access_token=${fbToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipient_id },
            message: { text: message },
          }),
        },
      );
      const metaData = await metaRes.json() as Record<string, unknown>;
      if (!metaRes.ok) {
        return new Response(JSON.stringify({ error: 'Messenger API error', details: metaData }), {
          status: metaRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      metaMessageId = (metaData as { message_id?: string }).message_id ?? null;
    }

    // ── Persist outbound message ────────────────────────────────────────
    await db.from('wa_messages').insert({
      business_id,
      conversation_id,
      contact_id,
      channel,
      wa_message_id: metaMessageId,
      direction: 'outbound',
      type: 'text',
      content: message,
      status: 'sent',
      wa_timestamp: new Date().toISOString(),
    });

    // Update conversation last_message_at and clear handoff flag (manual send = human is handling it)
    await db.from('wa_conversations').update({
      last_message_at: new Date().toISOString(),
      status: 'open',
      needs_human: false,
    }).eq('id', conversation_id);

    return new Response(JSON.stringify({ success: true, message_id: metaMessageId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[meta-send] error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
