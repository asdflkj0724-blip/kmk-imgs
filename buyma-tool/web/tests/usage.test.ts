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
  it('AI費用が月額の9割を超えたら、件数が残っていても止める', () => {
    const mini = { plan: 'mini', subscriptionStatus: 'active', trialEndsAt: null };
    expect(checkAllowance(mini, 5, now, 881).allowed).toBe(true); // 980円 × 0.9 = 882円
    const a = checkAllowance(mini, 5, now, 882);
    expect(a.allowed).toBe(false);
    expect(a.reason).toMatch(/AI の利用量/);
  });
  it('お試しは AI 費用200円まで', () => {
    const t = { plan: 'trial', subscriptionStatus: null, trialEndsAt: '2026-11-20T00:00:00Z' };
    expect(checkAllowance(t, 1, now, 199).allowed).toBe(true);
    expect(checkAllowance(t, 1, now, 200).allowed).toBe(false);
  });
  it('見込みの1.5倍の費用（1件4.35円）でも、上限件数までは止まらない', async () => {
    const { PLANS } = await import('@/lib/plans');
    for (const p of Object.values(PLANS)) {
      const cost = (p.monthlyLimit - 1) * 4.35;
      expect(checkAllowance({ plan: p.id, subscriptionStatus: 'active', trialEndsAt: null }, p.monthlyLimit - 1, now, cost).allowed).toBe(true);
    }
  });
});
