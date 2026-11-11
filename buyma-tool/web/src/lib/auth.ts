/**
 * API の利用者を確かめる。
 * - 拡張機能から：Authorization: Bearer <アクセストークン>
 * - 管理画面から：ログインの cookie
 */
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase/admin';
import { supabaseServer } from './supabase/server';

export async function getRequestUser(req: Request): Promise<User | null> {
  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const { data, error } = await supabaseAdmin().auth.getUser(header.slice(7));
    return error ? null : data.user;
  }
  const { data } = await (await supabaseServer()).auth.getUser();
  return data.user ?? null;
}
