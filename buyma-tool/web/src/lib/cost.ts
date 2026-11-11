/**
 * AI の費用の計算（指示書 §5「1件あたりの AI 費用を計算して、どのプランでも利益が残るか確認」）。
 * 料金は Anthropic の公開価格（100万トークンあたりの米ドル）。変わったらここを直す。
 */
import { PLANS } from './plans';

export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES_USD_PER_MTOK[model] ?? MODEL_PRICES_USD_PER_MTOK['claude-sonnet-5-5'];
  const cacheWrite = (u.cache_creation_input_tokens ?? 0) * p.input * 1.25;
  const total =
    u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + cacheWrite;
  return total / 1_000_000;
}

export interface PlanMargin {
  plan: string;
  priceJpy: number;
  limit: number;
  aiCostJpyAtLimit: number;
  stripeFeeJpy: number;
  marginJpy: number;
  ok: boolean;
}

/**
 * 全員が上限いっぱいまで使った場合の、プランごとの粗利（AI 費用と Stripe 手数料だけを引いたもの）。
 * サーバー代などは含まない。
 */
export function planMargins(perItemUsd: number, usdJpy: number, stripeFeeRate = 0.036): PlanMargin[] {
  return Object.values(PLANS).map((p) => {
    const ai = p.monthlyLimit * perItemUsd * usdJpy;
    const fee = p.monthlyPriceJpy * stripeFeeRate;
    const margin = p.monthlyPriceJpy - ai - fee;
    return {
      plan: p.name,
      priceJpy: p.monthlyPriceJpy,
      limit: p.monthlyLimit,
      aiCostJpyAtLimit: Math.round(ai),
      stripeFeeJpy: Math.round(fee),
      marginJpy: Math.round(margin),
      ok: margin > 0,
    };
  });
}
