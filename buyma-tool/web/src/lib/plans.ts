/**
 * 料金プラン（指示書 §5 のたたき台）。金額・件数はここだけ直せば全体に反映される。
 */
export type PlanId = 'trial' | 'mini' | 'light' | 'standard' | 'pro';
export type BillingInterval = 'month' | 'year';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPriceJpy: number;
  /** 年払いは2か月分お得＝月額×10 */
  yearlyPriceJpy: number;
  monthlyLimit: number;
  features: string[];
  highlight?: boolean;
}

export const TRIAL_DAYS = 7;
export const TRIAL_LIMIT = 10;
/** 紹介で来た人のお試し日数（1か月無料） */
export const REFERRAL_TRIAL_DAYS = 30;

/**
 * 赤字を防ぐ安全装置：1人の1か月の AI 費用が、月額料金のこの割合を超えたら、その月は止める。
 * 9割なら、Stripe の手数料（約3.6%）を引いても赤字にならない。普通の使い方では届かない。
 */
export const AI_COST_GUARD_RATE = 0.9;
/** 無料お試しで使える AI 費用の上限（円） */
export const TRIAL_AI_COST_CAP_JPY = 200;
/** AI の費用（ドル）を円にするときのレート。少し円安ぎみに見ておく */
export const USD_JPY = Number(process.env.USD_JPY || 160);

export const PLANS: Record<Exclude<PlanId, 'trial'>, Plan> = {
  mini: {
    id: 'mini',
    name: 'ミニ',
    monthlyPriceJpy: 980,
    yearlyPriceJpy: 9800,
    monthlyLimit: 30,
    features: ['月30件まで', 'タイトル・説明文の自動作成', '価格の自動計算', 'BUYMAへの自動入力・CSV・画像ZIP'],
  },
  light: {
    id: 'light',
    name: 'ライト',
    monthlyPriceJpy: 1980,
    yearlyPriceJpy: 19800,
    monthlyLimit: 100,
    features: ['月100件まで', 'ミニの機能すべて', '1件あたり約20円'],
  },
  standard: {
    id: 'standard',
    name: 'スタンダード',
    monthlyPriceJpy: 2980,
    yearlyPriceJpy: 29800,
    monthlyLimit: 500,
    features: ['月500件まで', 'ライトの機能すべて', '1件あたり約6円'],
    highlight: true,
  },
  pro: {
    id: 'pro',
    name: 'プロ',
    monthlyPriceJpy: 4980,
    yearlyPriceJpy: 49800,
    monthlyLimit: 1000,
    features: ['月1,000件まで', 'スタンダードの機能すべて', '在庫・価格チェック（準備中）', '1件あたり約5円'],
  },
};

export const PAID_PLAN_IDS = Object.keys(PLANS) as Exclude<PlanId, 'trial'>[];

export function isPaidPlan(id: string): id is Exclude<PlanId, 'trial'> {
  return (PAID_PLAN_IDS as string[]).includes(id);
}

/** Stripe の価格 ID（環境変数）とプランの対応 */
export function stripePriceId(plan: Exclude<PlanId, 'trial'>, interval: BillingInterval): string | undefined {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`;
  return process.env[key] || undefined;
}

export function planFromStripePrice(priceId: string): { plan: Exclude<PlanId, 'trial'>; interval: BillingInterval } | null {
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of ['month', 'year'] as const) {
      if (stripePriceId(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}
