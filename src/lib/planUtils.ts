import { Database } from '@/integrations/supabase/types';

type Business = Database['public']['Tables']['businesses']['Row'];

export const TRIAL_DAYS = 15;

/**
 * Returns the effective plan for a business.
 * If the business is on a paid plan (pro/starter) with an expiry date that has
 * already passed, it is treated as 'free' (expired trial).
 */
export function getEffectivePlan(
  business: Business | null | undefined,
): 'free' | 'starter' | 'pro' {
  if (!business) return 'free';
  const plan = (business.plan ?? 'free') as 'free' | 'starter' | 'pro';
  if (
    plan !== 'free' &&
    business.plan_expires_at &&
    new Date(business.plan_expires_at) < new Date()
  ) {
    return 'free';
  }
  return plan;
}

/**
 * Returns true if the business is currently on a trial
 * (pro plan with an expiry date that has NOT yet passed).
 */
export function isTrial(business: Business | null | undefined): boolean {
  if (!business) return false;
  return (
    business.plan === 'pro' &&
    !!business.plan_expires_at &&
    new Date(business.plan_expires_at) > new Date()
  );
}

/**
 * Returns the number of days remaining in the trial, or null if not on trial.
 */
export function trialDaysLeft(business: Business | null | undefined): number | null {
  if (!isTrial(business) || !business?.plan_expires_at) return null;
  const diff = new Date(business.plan_expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}
