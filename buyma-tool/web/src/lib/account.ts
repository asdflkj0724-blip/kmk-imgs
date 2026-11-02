/** サーバー側：ユーザーのプラン・使った回数・設定・為替をまとめて読む */
import { supabaseAdmin } from './supabase/admin';
import { checkAllowance, jstMonthStart, type Allowance } from './usage';
import { isPaidPlan, PLANS } from './plans';
import { mergeSettings, type PricingSettings } from './pricing';
import { chooseRate, type FxChoice } from './fx';

export interface Profile {
  id: string;
  email: string | null;
  plan: string;
  billing_interval: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  pricing_settings: Partial<PricingSettings> | null;
  fixed_fx_rate: number | null;
  referral_code: string;
  referred_by: string | null;
  referral_rewarded: boolean;
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabaseAdmin().from('profiles').select('*').eq('id', userId).single();
  if (error || !data) throw new Error('プロフィールが見つかりません');
  return data as Profile;
}

export async function getAllowance(profile: Profile, now = new Date()): Promise<Allowance> {
  const paid = isPaidPlan(profile.plan) && ['active', 'trialing'].includes(profile.subscription_status || '');
  let q = supabaseAdmin()
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('kind', 'generate');
  if (paid) q = q.gte('created_at', jstMonthStart(now));
  const { count, error } = await q;
  if (error) throw new Error('使用回数を読めませんでした');
  return checkAllowance(
    { plan: profile.plan, subscriptionStatus: profile.subscription_status, trialEndsAt: profile.trial_ends_at },
    count ?? 0,
    now
  );
}

export function planName(profile: Profile): string {
  return isPaidPlan(profile.plan) ? PLANS[profile.plan].name : '無料お試し';
}

export async function latestFx(): Promise<{ rate: number; date: string; source: string } | null> {
  const { data } = await supabaseAdmin()
    .from('fx_rates')
    .select('date, cny_jpy, source')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { rate: Number(data.cny_jpy), date: data.date, source: data.source } : null;
}

export async function fxFor(profile: Profile): Promise<FxChoice | null> {
  return chooseRate(profile.fixed_fx_rate ? Number(profile.fixed_fx_rate) : null, await latestFx());
}

export function settingsFor(profile: Profile): PricingSettings {
  return mergeSettings(profile.pricing_settings);
}
