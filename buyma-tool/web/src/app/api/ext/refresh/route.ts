/** 拡張機能のログインを延長する（リフレッシュトークン → 新しいアクセストークン） */
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { json, preflight } from '@/lib/http';

export const OPTIONS = preflight;

export async function POST(req: Request) {
  const parsed = z.object({ refreshToken: z.string().min(10).max(2000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: '内容が正しくありません' }, 400);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: parsed.data.refreshToken });
  if (error || !data.session) return json(req, { error: 'もう一度ログインしてください' }, 401);
  return json(req, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
}
