import { getRequestUser } from '@/lib/auth';
import { corsHeaders, json, preflight } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, type ListingRow } from '@/lib/csv';

export const OPTIONS = preflight;

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const params = new URL(req.url).searchParams;
  let q = supabaseAdmin()
    .from('listings')
    .select('id, title_ja, description_ja, price_jpy, cost_cny, fx_rate, source_url, item_id, colors, sizes, image_urls, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(2000);
  const ids = params.get('ids')?.split(',').filter(Boolean);
  if (ids?.length) q = q.in('id', ids.slice(0, 500));
  const status = params.get('status');
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return json(req, { error: '読み込みに失敗しました' }, 500);

  const rows: ListingRow[] = (data ?? []).map((r) => ({
    ...r,
    price_jpy: r.price_jpy,
    cost_cny: r.cost_cny === null ? null : Number(r.cost_cny),
    fx_rate: r.fx_rate === null ? null : Number(r.fx_rate),
    image_count: (r.image_urls ?? []).length,
    colors: r.colors ?? [],
    sizes: r.sizes ?? [],
  }));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="buyma_listings_${date}.csv"`,
      ...corsHeaders(req),
    },
  });
}
