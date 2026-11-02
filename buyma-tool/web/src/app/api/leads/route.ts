import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

const Body = z.object({
  email: z.string().trim().email().max(200),
  source: z.string().trim().max(40).default('guide'),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '送信内容を読み取れませんでした' }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'メールアドレスを確認してください' }, { status: 400 });
  const { error } = await supabaseAdmin().from('leads').insert(parsed.data);
  if (error) return Response.json({ error: '登録できませんでした。時間をおいてもう一度お試しください' }, { status: 500 });
  return Response.json({ ok: true });
}
