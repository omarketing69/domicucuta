import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller is super admin
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

    // Check caller has admin role
    const { data: roleData } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerUser.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Forbidden: not a super admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, businessName, whatsappNumber, plan, currency } = await req.json();

    // Validate inputs
    if (!email || !password || !businessName || !whatsappNumber) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Create auth user
    const { data: newUser, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (userError || !newUser.user) {
      return new Response(JSON.stringify({ error: userError?.message ?? 'Failed to create user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Assign 'user' role
    await supabaseAdmin.from('user_roles').insert({
      user_id: newUser.user.id,
      role: 'user',
    });

    // 3. Generate slug from business name
    const slug = businessName
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check slug uniqueness, append random suffix if needed
    const { data: existing } = await supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    const finalSlug = existing ? `${slug}-${Math.random().toString(36).slice(2, 6)}` : slug;

    // 4. Determine plan expiry
    const planDays = plan === 'free' ? 30 : 365;
    const planExpiresAt = new Date();
    planExpiresAt.setDate(planExpiresAt.getDate() + planDays);

    // 5. Create business
    const { data: business, error: bizError } = await supabaseAdmin
      .from('businesses')
      .insert({
        name: businessName,
        slug: finalSlug,
        owner_id: newUser.user.id,
        whatsapp_number: whatsappNumber,
        plan: plan ?? 'free',
        currency: currency ?? 'COP',
        plan_started_at: new Date().toISOString(),
        plan_expires_at: planExpiresAt.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (bizError) {
      // Rollback: delete created user
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: bizError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ user: newUser.user, business }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
