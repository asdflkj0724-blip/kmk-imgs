/** サーバー側：ユーザーのプラン・使った回数・設定・為替をまとめて読む */
import { supabaseAdmin } from './supabase/admin';
import { checkAllowance, isAccountActive, jstMonthStart, type Allowance } from './usage';
import { isPaidPlan, PLANS, USD_JPY } from './plans';
import { mergeSettings, type PricingSettings } from './pricing';
import { chooseRate, type Currency, type FxChoice, type FxQuote } from './fx';
import { isStale, refreshFxRates } from './fxStore';

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
  fixed_fx_rates: Record<string, number> | null;
  shipping_method: string | null;
  writing_tone: 'polite' | 'casual' | null;
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
  // AI の費用（件数の作成とスクショ読み取りの両方）。赤字を防ぐ安全装置に使う
  let cq = supabaseAdmin().from('usage_events').select('cost_usd').eq('user_id', profile.id).limit(10000);
  if (paid) cq = cq.gte('created_at', jstMonthStart(now));
  const [{ count, error }, costs] = await Promise.all([q, cq]);
  if (error || costs.error) throw new Error('使用回数を読めませんでした');
  const aiCostJpy = (costs.data ?? []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0) * USD_JPY;
  return checkAllowance(
    { plan: profile.plan, subscriptionStatus: profile.subscription_status, trialEndsAt: profile.trial_ends_at },
    count ?? 0,
    now,
    aiCostJpy
  );
}

export function accountActive(profile: Profile, now = new Date()): boolean {
  return isAccountActive({ plan: profile.plan, subscriptionStatus: profile.subscription_status, trialEndsAt: profile.trial_ends_at }, now);
}

export function planName(profile: Profile): string {
  return isPaidPlan(profile.plan) ? PLANS[profile.plan].name : '無料お試し';
}

async function readFx(currency?: Currency) {
  let q = supabaseAdmin().from('fx_rates').select('date, cny_jpy, source, currency').order('date', { ascending: false }).limit(100);
  if (currency) q = q.eq('currency', currency);
  const { data, error } = await q;
  if (error) console.error('fx read failed', error.message);
  const out: Record<string, FxQuote> = {};
  for (const r of data ?? []) {
    if (!out[r.currency]) out[r.currency] = { currency: r.currency, rate: Number(r.cny_jpy), date: r.date, source: r.source };
  }
  return out;
}

/** 保存された自動レートが無い・古いときは、その場で取りに行く（毎朝の自動取得が失敗した日でも止まらないように） */
async function readFxFresh(currency?: Currency): Promise<Record<string, FxQuote>> {
  const rates = await readFx(currency);
  const needed = currency ? [rates[currency]] : Object.values(rates);
  if (needed.length && needed.every((r) => r && !isStale(r.date))) return rates;
  try {
    await refreshFxRates();
    return await readFx(currency);
  } catch (e) {
    console.error('fx refresh failed', (e as Error).message);
    return rates;
  }
}

/** その通貨の、いちばん新しい自動レート（1単位＝何円） */
export async function latestFx(currency: Currency = 'CNY'): Promise<FxQuote | null> {
  if (currency === 'TWD' || currency === 'JPY') return (await readFx(currency))[currency] ?? null;
  return (await readFxFresh(currency))[currency] ?? null;
}

/** すべての通貨の、いちばん新しい自動レート */
export async function latestFxAll(): Promise<Record<string, FxQuote>> {
  return readFxFresh();
}

export function fixedRatesOf(profile: Profile): Record<string, number> {
  const rates: Record<string, number> = { ...(profile.fixed_fx_rates ?? {}) };
  if (!rates.CNY && profile.fixed_fx_rate) rates.CNY = Number(profile.fixed_fx_rate);
  return rates;
}

export async function fxFor(profile: Profile, currency: Currency = 'CNY'): Promise<FxChoice | null> {
  return chooseRate(currency, fixedRatesOf(profile), currency === 'JPY' ? null : await latestFx(currency));
}

export function settingsFor(profile: Profile): PricingSettings {
  return mergeSettings(profile.pricing_settings);
}
