/**
 * 使える回数の判定。AI の費用が赤字にならないよう、プランごとに上限を付ける。
 */
import { PLANS, TRIAL_LIMIT, isPaidPlan } from './plans';

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
 * @param usedThisPeriod 有料プラン：今月の件数。お試し：これまでの合計件数
 */
export function checkAllowance(account: AccountState, usedThisPeriod: number, now = new Date()): Allowance {
  const periodStart = jstMonthStart(now);
  const base = (limit: number, extra: Partial<Allowance> = {}): Allowance => {
    const remaining = Math.max(0, limit - usedThisPeriod);
    return { allowed: remaining > 0, limit, used: usedThisPeriod, remaining, periodStart, ...extra };
  };

  if (isPaidPlan(account.plan) && account.subscriptionStatus && ACTIVE.has(account.subscriptionStatus)) {
    const a = base(PLANS[account.plan].monthlyLimit);
    if (!a.allowed) a.reason = '今月の上限に達しました。来月まで待つか、上のプランに変更してください。';
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
  return a;
}
