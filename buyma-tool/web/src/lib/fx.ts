/**
 * 為替レート（各通貨→円）。毎日1回取得してデータベースに保存し、
 * ユーザーが固定レートを決めていればそちらを優先する。
 */

/** 毎日自動で取る通貨（欧州中央銀行の参考レートにあるもの） */
export const AUTO_CURRENCIES = ['CNY', 'KRW', 'USD', 'EUR', 'GBP', 'HKD'] as const;
/** 選べる通貨（台湾ドルは自動レートがないので、固定レートを入れて使う） */
export const SUPPORTED_CURRENCIES = ['CNY', 'KRW', 'USD', 'EUR', 'GBP', 'HKD', 'TWD', 'JPY'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  CNY: '人民元',
  KRW: '韓国ウォン',
  USD: '米ドル',
  EUR: 'ユーロ',
  GBP: '英ポンド',
  HKD: '香港ドル',
  TWD: '台湾ドル',
  JPY: '日本円',
};

/** 1単位＝何円か の、ありえる範囲（おかしな値を使わないため） */
const SANE_RANGE: Record<string, [number, number]> = {
  CNY: [5, 100],
  KRW: [0.01, 1],
  USD: [50, 500],
  EUR: [50, 500],
  GBP: [50, 600],
  HKD: [5, 100],
  TWD: [1, 20],
};

export function normalizeCurrency(c: string | null | undefined): Currency | null {
  const up = (c || '').trim().toUpperCase();
  const alias: Record<string, Currency> = { RMB: 'CNY', '元': 'CNY', '¥': 'CNY', '원': 'KRW', '₩': 'KRW', '$': 'USD', '€': 'EUR', '£': 'GBP', 'NT$': 'TWD', YEN: 'JPY', '円': 'JPY' };
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(up)) return up as Currency;
  return alias[up] ?? alias[(c || '').trim()] ?? null;
}

export function isSaneRate(currency: string, rate: number): boolean {
  const r = SANE_RANGE[currency];
  return !!r && rate > r[0] && rate < r[1];
}

export interface FxQuote {
  currency: Currency;
  rate: number; // 1単位＝何円
  date: string;
  source: string;
}

/** 欧州中央銀行の参考レートを配信している無料 API から、まとめて取る */
export async function fetchRates(fetchImpl: typeof fetch = fetch): Promise<FxQuote[]> {
  const to = AUTO_CURRENCIES.join(',');
  const res = await fetchImpl(`https://api.frankfurter.app/latest?from=JPY&to=${to}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`為替の取得に失敗しました（${res.status}）`);
  const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const date = body.date || new Date().toISOString().slice(0, 10);
  const out: FxQuote[] = [];
  for (const c of AUTO_CURRENCIES) {
    const perYen = body.rates?.[c];
    if (!perYen || perYen <= 0) continue;
    const rate = Math.round((1 / perYen) * 1e6) / 1e6; // 1円＝x通貨 → 1通貨＝1/x円
    if (isSaneRate(c, rate)) out.push({ currency: c, rate, date, source: 'frankfurter (ECB)' });
  }
  if (!out.length) throw new Error('為替の値がおかしいため使いません');
  return out;
}

export interface FxChoice {
  currency: Currency;
  rate: number;
  source: 'fixed' | 'daily' | 'same';
  date?: string;
}

/** 固定レートがあればそれ、なければ毎日の自動レート。円ならそのまま */
export function chooseRate(currency: Currency, fixedRates: Record<string, number> | null | undefined, latest: FxQuote | null): FxChoice | null {
  if (currency === 'JPY') return { currency, rate: 1, source: 'same' };
  const fixed = fixedRates?.[currency];
  if (fixed && fixed > 0) return { currency, rate: fixed, source: 'fixed' };
  if (latest && latest.currency === currency) return { currency, rate: latest.rate, source: 'daily', date: latest.date };
  return null;
}
