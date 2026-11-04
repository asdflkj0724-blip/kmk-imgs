/**
 * どのサイトでも使える読み取り。拡張機能がユーザーのブラウザで集めたページの中身を受け取り、
 * AI に商品情報を抜き出してもらう（サーバーから仕入れ先サイトにはアクセスしない）。
 */
import Anthropic from '@anthropic-ai/sdk';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { getAllowance, getProfile } from '@/lib/account';
import { AiRefusalError, PageSchema, clampPage, extractFromPage, extractToProduct } from '@/lib/ai';
import { costUsd } from '@/lib/cost';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const OPTIONS = preflight;
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const raw = (await req.json().catch(() => null)) as { page?: unknown } | null;
  // 拡張機能は { page: {...} } で送る（中身だけでも受け取れるようにしておく）
  const parsed = PageSchema.safeParse(clampPage(raw && typeof raw === 'object' && 'page' in raw ? raw.page : raw));
  if (!parsed.success) return json(req, { error: 'ページの中身の形が正しくありません' }, 400);
  const page = parsed.data;
  if (!page.pageText.trim() && !page.jsonLd.trim()) return json(req, { error: 'ページの中身が空です' }, 400);

  const profile = await getProfile(user.id);
  const allowance = await getAllowance(profile);
  if (!allowance.allowed) return json(req, { error: allowance.reason, allowance }, 402);

  try {
    const { result, usage, model } = await extractFromPage(page);
    await supabaseAdmin().from('usage_events').insert({
      user_id: user.id,
      kind: 'extract',
      model,
      input_tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens,
      cost_usd: costUsd(model, usage),
    });
    return json(req, { product: extractToProduct(page, result) });
  } catch (e) {
    if (e instanceof AiRefusalError) return json(req, { error: e.message }, 422);
    if (e instanceof Anthropic.RateLimitError) return json(req, { error: '混み合っています。少し待ってからもう一度お試しください' }, 503);
    if (e instanceof Anthropic.APIError) return json(req, { error: 'AI の呼び出しに失敗しました' }, 502);
    throw e;
  }
}
