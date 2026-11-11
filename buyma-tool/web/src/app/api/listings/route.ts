import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const OPTIONS = preflight;

const STATUSES = ['draft', 'listed'];

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const params = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 50));
  let q = supabaseAdmin()
    .from('listings')
    .select('id, title_ja, description_ja, price_jpy, colors, sizes, image_urls, item_id, source_url, status, status_note, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  const status = params.get('status');
  if (status && STATUSES.includes(status)) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return json(req, { error: '読み込みに失敗しました' }, 500);
  return json(req, { listings: data });
}
