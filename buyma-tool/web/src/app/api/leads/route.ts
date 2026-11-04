/** メール登録（ホームページの無料お試し登録・無料ガイド）。登録されたメールは Supabase の leads に保存する */
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  source: z.enum(['guide', 'waitlist']).default('guide'),
  /** 人には見えない欄。機械的な登録だけがここに書き込む */
  website: z.string().max(200).optional(),
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
  const { email, source, website } = parsed.data;
  // いたずらの機械登録には、成功したふりをして何も保存しない
  if (website) return Response.json({ ok: true });

  // 2回目の登録は、何もせず成功として返す（登録済みかどうかを外から調べられないように）
  const { error } = await supabaseAdmin()
    .from('leads')
    .upsert({ email, source }, { onConflict: 'email,source', ignoreDuplicates: true });
  if (error) return Response.json({ error: '登録できませんでした。時間をおいてもう一度お試しください' }, { status: 500 });
  return Response.json({ ok: true });
}
