import { describe, expect, it } from 'vitest';
import { checkAllowance, jstMonthStart } from '@/lib/usage';

const now = new Date('2026-11-15T03:00:00Z');

describe('checkAllowance', () => {
  it('有料プランは月の上限まで使える', () => {
    const a = checkAllowance({ plan: 'standard', subscriptionStatus: 'active', trialEndsAt: null }, 499, now);
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(1);
    const b = checkAllowance({ plan: 'standard', subscriptionStatus: 'active', trialEndsAt: null }, 500, now);
    expect(b.allowed).toBe(false);
    expect(b.reason).toMatch(/上限/);
  });

  it('お試しは期間内で10件まで', () => {
    const t = { plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-20T00:00:00Z' };
    expect(checkAllowance(t, 9, now).allowed).toBe(true);
    expect(checkAllowance(t, 10, now).allowed).toBe(false);
    expect(checkAllowance({ ...t, trialEndsAt: '2026-11-01T00:00:00Z' }, 0, now).allowed).toBe(false);
  });

  it('支払いが止まっている・解約後は使えない', () => {
    expect(checkAllowance({ plan: 'pro', subscriptionStatus: 'past_due', trialEndsAt: null }, 0, now).allowed).toBe(false);
    expect(checkAllowance({ plan: 'trial', subscriptionStatus: 'canceled', trialEndsAt: null }, 0, now).allowed).toBe(false);
  });

  it('月の区切りは日本時間', () => {
    // 日本時間 12/1 0:30 は UTC 11/30 15:30 → 12月の始まり（UTC 11/30 15:00）
    expect(jstMonthStart(new Date('2026-11-30T15:30:00Z'))).toBe('2026-11-30T15:00:00.000Z');
    expect(jstMonthStart(new Date('2026-11-30T14:30:00Z'))).toBe('2026-10-31T15:00:00.000Z');
  });
});

describe('赤字を防ぐ安全装置', () => {
  it('AI費用が月額の65%を超えたら、件数が残っていても止める', () => {
    const mini = { plan: 'mini', subscriptionStatus: 'active', trialEndsAt: null };
    expect(checkAllowance(mini, 5, now, 636).allowed).toBe(true); // 980円 × 0.65 = 637円
    const a = checkAllowance(mini, 5, now, 637);
    expect(a.allowed).toBe(false);
    expect(a.reason).toMatch(/AI の利用量/);
  });
  it('お試しは AI 費用200円まで', () => {
    const t = { plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-20T00:00:00Z' };
    expect(checkAllowance(t, 1, now, 199).allowed).toBe(true);
    expect(checkAllowance(t, 1, now, 200).allowed).toBe(false);
  });
  it('見込みの1.1倍の費用（1件3.2円）なら、上限件数までは止まらない', async () => {
    const { PLANS } = await import('@/lib/plans');
    for (const p of Object.values(PLANS)) {
      const cost = (p.monthlyLimit - 1) * 3.2;
      expect(checkAllowance({ plan: p.id, subscriptionStatus: 'active', trialEndsAt: null }, p.monthlyLimit - 1, now, cost).allowed).toBe(true);
    }
  });
});

it('安全装置があれば、どのプランでも月額の3割以上が利益として残る', async () => {
  const { PLANS, AI_COST_GUARD_RATE } = await import('@/lib/plans');
  for (const p of Object.values(PLANS)) {
    const worstAiCost = p.monthlyPriceJpy * AI_COST_GUARD_RATE + 4.5; // 止まる直前に1件ぶん超える
    const profit = p.monthlyPriceJpy - worstAiCost - p.monthlyPriceJpy * 0.036;
    expect(profit / p.monthlyPriceJpy).toBeGreaterThan(0.29);
  }
});

describe('使えるアカウントか（購入した人・お試し中の人だけ）', async () => {
  const { isAccountActive } = await import('@/lib/usage');
  it('お金を払っている人は使える', () => {
    expect(isAccountActive({ plan: 'light', subscriptionStatus: 'active', trialEndsAt: null }, now)).toBe(true);
  });
  it('お試し期間中は使える、終わったら使えない', () => {
    expect(isAccountActive({ plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-20T00:00:00Z' }, now)).toBe(true);
    expect(isAccountActive({ plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-01T00:00:00Z' }, now)).toBe(false);
  });
  it('支払いが止まった・解約した人は使えない', () => {
    expect(isAccountActive({ plan: 'pro', subscriptionStatus: 'past_due', trialEndsAt: null }, now)).toBe(false);
    expect(isAccountActive({ plan: 'trial', subscriptionStatus: 'canceled', trialEndsAt: '2026-11-01T00:00:00Z' }, now)).toBe(false);
  });
});
