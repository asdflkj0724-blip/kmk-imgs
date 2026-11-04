import { z } from 'zod';
import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkListing } from '@/lib/listingRules';

export const OPTIONS = preflight;

const Patch = z
  .object({
    status: z.enum(['draft', 'listed']).optional(),
    statusNote: z.string().max(1000).nullable().optional(),
    buymaUrl: z.string().url().max(500).nullable().optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(10000).optional(),
    priceJpy: z.number().int().positive().max(10_000_000).optional(),
  })
  .strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: '内容が正しくありません' }, 400);
  const p = parsed.data;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.status) update.status = p.status;
  if (p.statusNote !== undefined) update.status_note = p.statusNote;
  if (p.buymaUrl !== undefined) update.buyma_url = p.buymaUrl;
  if (p.title !== undefined) update.title_ja = p.title;
  if (p.description !== undefined) update.description_ja = p.description;
  if (p.priceJpy !== undefined) update.price_jpy = p.priceJpy;

  const db = supabaseAdmin();
  if (p.title !== undefined || p.description !== undefined) {
    const { data: cur } = await db.from('listings').select('title_ja, description_ja').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!cur) return json(req, { error: '見つかりません' }, 404);
    update.issues = checkListing({ title: p.title ?? cur.title_ja ?? '', description: p.description ?? cur.description_ja ?? '' });
  }

  const { data, error } = await db
    .from('listings')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, title_ja, description_ja, price_jpy, status, status_note, buyma_url, issues')
    .maybeSingle();
  if (error) return json(req, { error: '保存に失敗しました' }, 500);
  if (!data) return json(req, { error: '見つかりません' }, 404);
  return json(req, { listing: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin().from('listings').delete().eq('id', id).eq('user_id', user.id);
  if (error) return json(req, { error: '削除に失敗しました' }, 500);
  return json(req, { ok: true });
}
