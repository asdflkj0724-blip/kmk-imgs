/**
 * 【テスト専用・本番では動かない】中国語が混ざらないルールの効果を、同じ10件で確かめるためのもの。
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
const Body = z.object({ index: z.number().int().min(0).max(9) });

export async function POST(req: Request) {
  if (process.env.VERCEL_ENV === 'production' || Date.now() > EXPIRES) return new Response('Not found', { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'このプレビュー環境には API キーが設定されていません' }, { status: 500 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const { index } = parsed.data;
  const product = ProductSchema.parse((raw as unknown[])[index]);
  const t = Date.now();
  try {
    const r = await generateListing(product, '', anthropic(), 'polite');
    return Response.json({ ok: true, index, requested: r.model, served: r.model, ms: Date.now() - t, usage: r.usage, usd: costUsd(r.model, r.usage), generated: r.generated });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json({ ok: false, index, ms: Date.now() - t, status: err.status ?? null, message: String(err.message ?? 'error').slice(0, 300) });
  }
}
