import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { referralCreditJpy, subscriptionToProfile } from '@/lib/stripe';
import { planFromStripePrice } from '@/lib/plans';

const sub = (status: string, price: string) =>
  ({
    id: 'sub_1',
    status,
    customer: 'cus_1',
    metadata: { user_id: 'u1' },
    items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] },
  }) as unknown as Stripe.Subscription;

describe('stripe', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STANDARD_MONTHLY = 'price_std_m';
    process.env.STRIPE_PRICE_PRO_YEARLY = 'price_pro_y';
  });
  afterEach(() => {
    delete process.env.STRIPE_PRICE_STANDARD_MONTHLY;
    delete process.env.STRIPE_PRICE_PRO_YEARLY;
  });

  it('価格 ID からプランを探す', () => {
    expect(planFromStripePrice('price_pro_y')).toEqual({ plan: 'pro', interval: 'year' });
    expect(planFromStripePrice('price_unknown')).toBeNull();
  });
  it('有効な定期課金をプランに反映する', () => {
    const p = subscriptionToProfile(sub('active', 'price_std_m'));
    expect(p).toMatchObject({ plan: 'standard', billing_interval: 'month', subscription_status: 'active', stripe_subscription_id: 'sub_1' });
    expect(p.current_period_end).toBe(new Date(1_800_000_000_000).toISOString());
  });
  it('解約されたらお試し（使えない状態）に戻す', () => {
    expect(subscriptionToProfile(sub('canceled', 'price_std_m'))).toMatchObject({ plan: 'trial', stripe_subscription_id: null });
  });
  it('紹介のお礼はその人のプランの1か月分', () => {
    expect(referralCreditJpy('pro')).toBe(5980);
    expect(referralCreditJpy('trial')).toBe(2480);
  });
});
