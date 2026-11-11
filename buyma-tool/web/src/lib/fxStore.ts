/** 為替レートを取ってきてデータベースに保存する（毎朝の自動取得と、足りないときのその場の取得で使う） */
import { fetchRates, type FxQuote } from './fx';
import { supabaseAdmin } from './supabase/admin';

export async function refreshFxRates(fetchImpl: typeof fetch = fetch): Promise<FxQuote[]> {
  const quotes = await fetchRates(fetchImpl);
  const now = new Date().toISOString();
  // 列名 cny_jpy は昔の名残（中身は「その通貨1単位＝何円」）
  const { error } = await supabaseAdmin()
    .from('fx_rates')
    .upsert(quotes.map((q) => ({ date: q.date, currency: q.currency, cny_jpy: q.rate, source: q.source, fetched_at: now })));
  if (error) throw new Error(`為替の保存に失敗しました: ${error.message}`);
  return quotes;
}

/** 何日より古ければ取り直すか（土日・祝日は欧州中央銀行のレートが出ないので、少し余裕をもたせる） */
export const FX_STALE_DAYS = 5;

export function isStale(date: string | null | undefined, now = new Date()): boolean {
  if (!date) return true;
  const age = (now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400_000;
  return !(age >= 0) || age > FX_STALE_DAYS;
}
