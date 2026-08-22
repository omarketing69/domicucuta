/**
 * meta-oauth-callback — Supabase Edge Function
 *
 * Second step of the "Conectar Instagram/Facebook" flow. Meta redirects the
 * browser here (GET) after the owner grants permission. Verifies the signed
 * `state` (minted by meta-oauth-start, bound to a business_id), exchanges
 * the auth `code` for a long-lived Page access token, resolves the linked
 * Instagram Business Account, stores everything on the business row, and
 * redirects back to the Settings page. No Supabase auth header is available
 * on this leg (it's a plain browser navigation) — `state` is what proves
 * which business this belongs to, not the caller.
 *
 * Required secrets: META_APP_ID, META_APP_SECRET, META_OAUTH_STATE_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APP_BASE_URL = 'https://domicircuspop.replit.app';
const SETTINGS_URL = `${APP_BASE_URL}/admin/settings`;

function base64UrlDecode(str: string): Uint8Array {
  const pad = str.length % 4;
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function verifyState(token: string, secret: string): Promise<{ business_id: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid state');

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = base64UrlDecode(sigB64);
  const inputBytes = new TextEncoder().encode(signingInput);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, inputBytes);
  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('State expired');
  if (!payload.business_id) throw new Error('Missing business_id');
  return { business_id: payload.business_id as string };
}

function redirectWithError(reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${SETTINGS_URL}?meta_error=${encodeURIComponent(reason)}` },
  });
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.searchParams.get('error')) {
    return redirectWithError(url.searchParams.get('error_description') ?? 'denied');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectWithError('missing_params');
  }

  const appId = Deno.env.get('META_APP_ID');
  const appSecret = Deno.env.get('META_APP_SECRET');
  const stateSecret = Deno.env.get('META_OAUTH_STATE_SECRET');
  if (!appId || !appSecret || !stateSecret) {
    console.error('[meta-oauth-callback] Meta OAuth secrets not configured');
    return redirectWithError('not_configured');
  }

  let businessId: string;
  try {
    ({ business_id: businessId } = await verifyState(state, stateSecret));
  } catch (e) {
    console.warn('[meta-oauth-callback] state verification failed:', e);
    return redirectWithError('invalid_state');
  }

  try {
    const redirectUri = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/meta-oauth-callback`;

    // 1. Exchange the auth code for a short-lived user access token.
    const shortLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
    );
    if (!shortLivedRes.ok) {
      console.error('[meta-oauth-callback] short-lived token exchange failed:', await shortLivedRes.text());
      return redirectWithError('token_exchange_failed');
    }
    const { access_token: shortLivedToken } = await shortLivedRes.json() as { access_token: string };

    // 2. Exchange for a long-lived user access token (~60 days).
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`,
    );
    if (!longLivedRes.ok) {
      console.error('[meta-oauth-callback] long-lived token exchange failed:', await longLivedRes.text());
      return redirectWithError('token_exchange_failed');
    }
    const { access_token: longLivedUserToken } = await longLivedRes.json() as { access_token: string };

    // 3. List the Pages this user manages, with their linked Instagram Business Account.
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(longLivedUserToken)}`,
    );
    if (!pagesRes.ok) {
      console.error('[meta-oauth-callback] /me/accounts failed:', await pagesRes.text());
      return redirectWithError('pages_fetch_failed');
    }
    const { data: pages } = await pagesRes.json() as { data: MetaPage[] };
    if (!pages?.length) {
      return redirectWithError('no_pages_found');
    }

    // Take the first Page. A business managing multiple Pages picks the
    // first one for now — letting them choose is a follow-up improvement.
    const page = pages[0];

    const update: Record<string, string | null> = {
      fb_page_id: page.id,
      fb_page_token: page.access_token,
    };
    if (page.instagram_business_account?.id) {
      update.ig_page_id = page.instagram_business_account.id;
      update.ig_access_token = page.access_token;
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error: updateError } = await supabaseAdmin
      .from('businesses')
      .update(update)
      .eq('id', businessId);

    if (updateError) {
      console.error('[meta-oauth-callback] failed to save credentials:', updateError);
      return redirectWithError('save_failed');
    }

    return new Response(null, {
      status: 302,
      headers: { Location: `${SETTINGS_URL}?meta_connected=1` },
    });

  } catch (err) {
    console.error('[meta-oauth-callback] error:', err);
    return redirectWithError('internal_error');
  }
});
