/**
 * SSO token generation for CRM integration.
 *
 * Requests a short-lived (5-min) SSO URL from the `generate-sso-token`
 * Supabase Edge Function, which signs the JWT server-side using SSO_SECRET.
 * The signing secret never leaves the Edge Function environment.
 */

import { supabase } from '@/integrations/supabase/client';
import { getEffectivePlan } from '@/lib/planUtils';
import { Database } from '@/integrations/supabase/types';

type Business = Database['public']['Tables']['businesses']['Row'];

export const CRM_BASE_URL = 'https://multi-channel-crm.replit.app';

const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2 };

/**
 * Returns true for Pro plan (including active trials).
 * Accepts a Business object or a raw plan string for backward compat.
 */
export function hasCrmAccess(planOrBusiness: string | null | undefined | Business): boolean {
  let plan: string;
  if (planOrBusiness && typeof planOrBusiness === 'object') {
    plan = getEffectivePlan(planOrBusiness as Business);
  } else {
    plan = (planOrBusiness as string) ?? 'free';
  }
  return (PLAN_RANK[plan] ?? 0) >= PLAN_RANK['pro'];
}

export class SsoNotConfiguredError extends Error {
  constructor() {
    super('CRM integration not yet deployed');
    this.name = 'SsoNotConfiguredError';
  }
}

/**
 * Calls the generate-sso-token Edge Function and returns the ready-to-use
 * CRM SSO URL.
 * Throws SsoNotConfiguredError if the Edge Function is not deployed yet.
 * Throws Error for other failures (network, auth, etc.).
 */
export async function buildSsoUrl(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ sso_url: string }>(
    'generate-sso-token',
  );

  if (error) {
    const msg = error.message ?? '';
    // Edge Function not deployed → FunctionsRelayError or relay/404
    if (
      msg.includes('Failed to send') ||
      msg.includes('relay') ||
      msg.includes('404') ||
      msg.includes('not found') ||
      msg.toLowerCase().includes('edge function')
    ) {
      throw new SsoNotConfiguredError();
    }
    throw new Error(msg || 'Failed to generate SSO token');
  }

  if (!data?.sso_url) throw new Error('No SSO URL returned from server');

  return data.sso_url;
}
