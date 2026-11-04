/**
 * 使える回数の判定。AI の費用が赤字にならないよう、プランごとに上限を付ける。
 */
import { AI_COST_GUARD_RATE, PLANS, TRIAL_AI_COST_CAP_JPY, TRIAL_LIMIT, isPaidPlan } from './plans';

export interface AccountState {
  plan: string; // 'trial' | 'light' | ...
  subscriptionStatus: string | null; // Stripe の status（active, trialing, past_due, canceled...）
  trialEndsAt: string | null;
}

export interface Allowance {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  reason?: string;
  periodStart: string;
}

/** 日本時間の今月1日 0:00 を UTC の ISO 文字列で返す */
export function jstMonthStart(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000;
  return new Date(start).toISOString();
}

const ACTIVE = new Set(['active', 'trialing']);

/**
 * このアカウントでツールを使えるか（お金を払っている、または無料お試しの期間中）。
 * 月の件数の上限とは別。上限に達していても、払っている人は画像 ZIP などは使える。
 */
export function isAccountActive(account: AccountState, now = new Date()): boolean {
  if (isPaidPlan(account.plan) && !!account.subscriptionStatus && ACTIVE.has(account.subscriptionStatus)) return true;
  return account.plan === 'trial' && !!account.trialEndsAt && new Date(account.trialEndsAt) > now;
}

export const INACTIVE_REASON = 'このアカウントでは使えません。プランのお申し込み（またはお支払い方法の更新）をお願いします。';

/**
 * @param usedThisPeriod 有料プラン：今月の件数。お試し：これまでの合計件数
 * @param aiCostJpy 同じ期間に使った AI の費用（円）。赤字を防ぐ安全装置に使う
 */
export const COST_GUARD_REASON =
  '今月の AI の利用量が多くなったため、今月はここまでとさせてください（スクショ読み取りを多く使った場合などに起こります）。来月1日に戻ります。';

export function checkAllowance(account: AccountState, usedThisPeriod: number, now = new Date(), aiCostJpy = 0): Allowance {
  const periodStart = jstMonthStart(now);
  const base = (limit: number, extra: Partial<Allowance> = {}): Allowance => {
    const remaining = Math.max(0, limit - usedThisPeriod);
    return { allowed: remaining > 0, limit, used: usedThisPeriod, remaining, periodStart, ...extra };
  };

  if (isPaidPlan(account.plan) && account.subscriptionStatus && ACTIVE.has(account.subscriptionStatus)) {
    const plan = PLANS[account.plan];
    const a = base(plan.monthlyLimit);
    if (!a.allowed) a.reason = '今月の上限に達しました。来月まで待つか、上のプランに変更してください。';
    else if (aiCostJpy >= plan.monthlyPriceJpy * AI_COST_GUARD_RATE) {
      a.allowed = false;
      a.reason = COST_GUARD_REASON;
    }
    return a;
  }

  if (isPaidPlan(account.plan) && account.subscriptionStatus === 'past_due') {
    return { ...base(0), reason: 'お支払いが確認できていません。お支払い方法を更新してください。' };
  }

  // お試し（または解約後）
  const trialActive = account.plan === 'trial' && !!account.trialEndsAt && new Date(account.trialEndsAt) > now;
  if (!trialActive) {
    return { ...base(0), reason: '無料お試しが終わりました。プランを選んで続けてください。' };
  }
  const a = base(TRIAL_LIMIT, { periodStart: '1970-01-01T00:00:00.000Z' });
  if (!a.allowed) a.reason = `無料お試しの${TRIAL_LIMIT}件を使い切りました。プランを選んで続けてください。`;
  else if (aiCostJpy >= TRIAL_AI_COST_CAP_JPY) {
    a.allowed = false;
    a.reason = '無料お試しで使える AI の量を超えました。プランを選んで続けてください。';
  }
  return a;
}
