/**
 * 為替レート（人民元→円）。毎日1回取得してデータベースに保存し、
 * ユーザーが固定レートを決めていればそちらを優先する。
 */
export interface FxQuote {
  rate: number;
  date: string;
  source: string;
}

/** 欧州中央銀行の参考レートを配信している無料 API */
export async function fetchCnyJpy(fetchImpl: typeof fetch = fetch): Promise<FxQuote> {
  const res = await fetchImpl('https://api.frankfurter.app/latest?from=CNY&to=JPY', { cache: 'no-store' });
  if (!res.ok) throw new Error(`為替の取得に失敗しました（${res.status}）`);
  const body = (await res.json()) as { date?: string; rates?: { JPY?: number } };
  const rate = body.rates?.JPY;
  if (!rate || !(rate > 5 && rate < 100)) throw new Error('為替の値がおかしいため使いません');
  return { rate, date: body.date || new Date().toISOString().slice(0, 10), source: 'frankfurter (ECB)' };
}

export interface FxChoice {
  rate: number;
  source: 'fixed' | 'daily';
  date?: string;
}

/** 固定レートがあればそれ、なければ毎日の自動レート */
export function chooseRate(fixedRate: number | null | undefined, latest: FxQuote | null): FxChoice | null {
  if (fixedRate && fixedRate > 0) return { rate: fixedRate, source: 'fixed' };
  if (latest) return { rate: latest.rate, source: 'daily', date: latest.date };
  return null;
}
