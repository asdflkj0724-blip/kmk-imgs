/**
 * 【テスト専用・本番では動かない】Sonnet と Haiku の文章を同じ10件で比べるためのもの。
 * - 本番（VERCEL_ENV=production）と期限切れのときは 404
 * - API キーは Vercel に保存済みのものをサーバー内で使うだけで、画面・ログ・返事には一切出さない
 */
import { z } from 'zod';
import { anthropic, generateListing } from '@/lib/ai';
import { costUsd } from '@/lib/cost';
import { ProductSchema } from '@/lib/product';
import raw from './products.json';

export const maxDuration = 60;
const EXPIRES = Date.parse('2026-12-04T00:00:00Z');
const MODELS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' } as const;
const Body = z.object({ index: z.number().int().min(0).max(9), model: z.enum(['sonnet', 'haiku', 'haiku-before-fix']) });

function blocked() {
  return process.env.VERCEL_ENV === 'production' || Date.now() > EXPIRES;
}

export async function POST(req: Request) {
  if (blocked()) return new Response('Not found', { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'このプレビュー環境には API キーが設定されていません' }, { status: 500 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const { index, model } = parsed.data;

  // 修正前の動き（Haiku に自動切り替えの指定を付ける）でエラーになるかだけを確かめる。返事は数文字なので費用はほぼ0
  if (model === 'haiku-before-fix') {
    try {
      await anthropic().beta.messages.create({
        model: MODELS.haiku,
        max_tokens: 5,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content: 'OK とだけ返して' }],
      } as never);
      return Response.json({ ok: true, note: '修正前の指定でもエラーになりませんでした' });
    } catch (e) {
      const err = e as { status?: number; error?: { error?: { type?: string; message?: string } } };
      return Response.json({ ok: false, status: err.status ?? null, type: err.error?.error?.type ?? null, message: err.error?.error?.message ?? 'error' });
    }
  }

  const product = ProductSchema.parse((raw as unknown[])[index]);
  const id = MODELS[model];
  const t = Date.now();
  try {
    const r = await generateListing(product, '', anthropic(), 'polite', id);
    return Response.json({ ok: true, index, requested: id, served: r.model, ms: Date.now() - t, usage: r.usage, usd: costUsd(id, r.usage), generated: r.generated });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, index, requested: id, ms: Date.now() - t, status: err.status ?? null, message: String(err.message ?? 'error').slice(0, 300) });
  }
}
