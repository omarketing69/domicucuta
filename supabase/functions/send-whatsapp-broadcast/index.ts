import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Recipient {
  /** Stable client-side identifier (e.g. customer UUID) for event correlation */
  clientId: string;
  phone: string;
  name: string;
  notes?: string;
}

interface RequestBody {
  business_id: string;
  recipients: Recipient[];
  message: string;
}

function cleanPhone(raw: string): string {
  let p = raw.replace(/[\s\-().+]/g, '');
  if (!p) return '';
  if (p.length === 10 && p.startsWith('3')) p = '57' + p;
  return p;
}

function fillTemplate(template: string, name: string, phone: string, notes: string): string {
  return template
    .replace(/\{nombre\}/gi, name)
    .replace(/\{telefono\}/gi, phone)
    .replace(/\{notas\}/gi, notes);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callerUser } } = await userClient.auth.getUser();
    if (!callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();
    const { business_id, recipients, message } = body;

    if (!business_id || !recipients?.length || !message?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing required fields: business_id, recipients, message' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: business, error: bizError } = await supabaseAdmin
      .from('businesses')
      .select('id, owner_id, plan, wa_phone_number_id, wa_access_token')
      .eq('id', business_id)
      .maybeSingle();

    if (bizError || !business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (business.owner_id !== callerUser.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: you do not own this business' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (business.plan !== 'pro') {
      return new Response(JSON.stringify({ error: 'Auto-broadcast requires plan Pro' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!business.wa_phone_number_id || !business.wa_access_token) {
      return new Response(JSON.stringify({ error: 'WhatsApp Business API credentials not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneNumberId = business.wa_phone_number_id;
    const accessToken = business.wa_access_token;
    const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    /**
     * Response contract (text/event-stream):
     *  - Per-recipient event (as each parallel send resolves):
     *      data: {"clientId":"<uuid>","phone":"<phone>","ok":true}
     *      data: {"clientId":"<uuid>","phone":"<phone>","ok":false,"error":"<reason>"}
     *  - Final summary event (stream end):
     *      data: {"done":true,"sent":<n>,"failed":[{"phone":"<phone>","name":"<name>","error":"<reason>"}]}
     */
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();

    const emit = async (obj: Record<string, unknown>) => {
      await writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
    };

    // Kick off parallel sends in the background; stream results as they arrive
    (async () => {
      let sent = 0;
      const failed: { phone: string; name: string; error: string }[] = [];

      await Promise.allSettled(
        recipients.map(async (recipient) => {
          const cleanedPhone = cleanPhone(recipient.phone);
          if (!cleanedPhone) {
            const err = 'Número de teléfono inválido';
            failed.push({ phone: recipient.phone, name: recipient.name, error: err });
            await emit({ clientId: recipient.clientId, phone: recipient.phone, ok: false, error: err });
            return;
          }

          const filledMessage = fillTemplate(message, recipient.name, recipient.phone, recipient.notes ?? '');
          try {
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: cleanedPhone,
                type: 'text',
                text: { body: filledMessage },
              }),
            });
            const data = await res.json() as { error?: { message?: string } };
            if (!res.ok) {
              const err = data?.error?.message ?? `HTTP ${res.status}`;
              failed.push({ phone: recipient.phone, name: recipient.name, error: err });
              await emit({ clientId: recipient.clientId, phone: recipient.phone, ok: false, error: err });
            } else {
              sent++;
              await emit({ clientId: recipient.clientId, phone: recipient.phone, ok: true });
            }
          } catch (fetchErr: unknown) {
            const err = fetchErr instanceof Error ? fetchErr.message : 'Error de red';
            failed.push({ phone: recipient.phone, name: recipient.name, error: err });
            await emit({ clientId: recipient.clientId, phone: recipient.phone, ok: false, error: err });
          }
        })
      );

      // Final summary event
      await emit({ done: true, sent, failed });
      await writer.close();
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
