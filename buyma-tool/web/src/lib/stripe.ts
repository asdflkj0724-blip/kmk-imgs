import Stripe from 'stripe';
import { planFromStripePrice, PLANS, type BillingInterval, type PlanId } from './plans';

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY が設定されていません');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export interface ProfileBillingUpdate {
  plan: PlanId;
  billing_interval: BillingInterval | null;
  subscription_status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

/** Stripe の定期課金の状態 → プロフィールに保存する値 */
export function subscriptionToProfile(sub: Stripe.Subscription): ProfileBillingUpdate {
  const item = sub.items.data[0];
  const mapped = item ? planFromStripePrice(item.price.id) : null;
  const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';
  return {
    plan: ended || !mapped ? 'trial' : mapped.plan,
    billing_interval: ended || !mapped ? null : mapped.interval,
    subscription_status: sub.status,
    stripe_subscription_id: ended ? null : sub.id,
    current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
  };
}

/** 紹介した人へのお礼：その人のプランの1か月分を、次回の請求から差し引く（円は小数なし） */
export function referralCreditJpy(referrerPlan: string): number {
  const p = (PLANS as Record<string, { monthlyPriceJpy: number }>)[referrerPlan];
  return p ? p.monthlyPriceJpy : PLANS.light.monthlyPriceJpy;
}

export function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}
