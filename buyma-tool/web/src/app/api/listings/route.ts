import { getRequestUser } from '@/lib/auth';
import { json, preflight } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { accountActive, getProfile } from '@/lib/account';
import { INACTIVE_REASON } from '@/lib/usage';

export const OPTIONS = preflight;

const STATUSES = ['draft', 'queued', 'filled', 'listed', 'failed'];

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return json(req, { error: 'ログインしてください' }, 401);
  const params = new URL(req.url).searchParams;
  // BUYMA への順番入力（拡張機能）は、使える状態のアカウントだけ
  if (params.get('status') === 'queued' && !accountActive(await getProfile(user.id))) {
    return json(req, { error: INACTIVE_REASON }, 402);
  }
  const limit = Math.min(200, Math.max(1, Number(params.get('limit')) || 50));
  let q = supabaseAdmin()
    .from('listings')
    .select('id, title_ja, description_ja, price_jpy, colors, sizes, image_urls, item_id, source_url, status, status_note, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: params.get('status') === 'queued' })
    .limit(limit);
  const status = params.get('status');
  if (status && STATUSES.includes(status)) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return json(req, { error: '読み込みに失敗しました' }, 500);
  return json(req, { listings: data });
}
