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
