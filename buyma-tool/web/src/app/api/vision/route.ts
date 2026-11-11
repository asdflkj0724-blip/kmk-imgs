/** スクリーンショットから商品情報を読み取る（拡張機能で取れなかったときの逃げ道） */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { getAllowance, getProfile } from '@/lib/account';
import { AiRefusalError, readScreenshot } from '@/lib/ai';
import { costUsd } from '@/lib/cost';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const OPTIONS = preflight;
export const maxDuration = 60;

const Body = z.object({
  imageBase64: z.string().min(100).max(7_000_000), // 約5MBまで
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  url: z.string().max(2000).default(''),
});

/** 1か月に読み取れる回数（出品件数の上限とは別。使いすぎ防止） */
const VISION_MONTHLY_CAP = 300;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: '画像が大きすぎるか、形が正しくありません' }, 400);

  const profile = await getProfile(user.id);
  const allowance = await getAllowance(profile);
  if (!allowance.allowed) return json(req, { error: allowance.reason, allowance }, 402);

  const db = supabaseAdmin();
  const { count } = await db
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('kind', 'vision')
    .gte('created_at', allowance.periodStart);
  if ((count ?? 0) >= VISION_MONTHLY_CAP) return json(req, { error: '今月のスクショ読み取りの上限に達しました' }, 402);

  const { imageBase64, mediaType, url } = parsed.data;
  try {
    const { result, usage, model } = await readScreenshot(imageBase64, mediaType);
    await db.from('usage_events').insert({
      user_id: user.id,
      kind: 'vision',
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: costUsd(model, usage),
    });
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();
    const itemId = (() => {
      try {
        return new URL(url).searchParams.get('id') || '';
      } catch {
        return '';
      }
    })();
    const price =
      result.priceMin != null
        ? { min: result.priceMin, max: result.priceMax ?? result.priceMin, currency: result.currency || 'CNY', raw: '' }
        : null;
    return json(req, {
      product: {
        source: /tmall/.test(host) ? 'tmall' : /taobao/.test(host) ? 'taobao' : 'unknown',
        itemId,
        url,
        title: result.title,
        price,
        skus: result.skus.map((g) => ({ name: g.name, values: g.values.map((v) => ({ name: v, image: '', disabled: false })) })),
        specs: result.specs,
        images: [],
        complete: !!(result.title && price),
        warnings: [],
        extractedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    if (e instanceof AiRefusalError) return json(req, { error: e.message }, 422);
    if (e instanceof Anthropic.APIError) return json(req, { error: 'うまく処理できませんでした。時間をおいてお試しください' }, 502);
    throw e;
  }
}
