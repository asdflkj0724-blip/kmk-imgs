/** メールのリンクや Google ログインから戻ってきたところ */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { REFERRAL_TRIAL_DAYS } from '@/lib/plans';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') || '/dashboard';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';
  if (!code) return NextResponse.redirect(new URL('/login?error=1', url.origin));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL('/login?error=1', url.origin));

  // Google ログインで登録した人の紹介コード（メール登録はデータベースの仕組みで処理済み）
  const store = await cookies();
  const ref = store.get('ref')?.value;
  if (ref) {
    const db = supabaseAdmin();
    const { data: me } = await db.from('profiles').select('id, referred_by, created_at, plan').eq('id', data.user.id).maybeSingle();
    const isNew = me && Date.now() - new Date(me.created_at).getTime() < 10 * 60_000;
    if (me && isNew && !me.referred_by && me.plan === 'trial') {
      const { data: referrer } = await db.from('profiles').select('id').eq('referral_code', ref).neq('id', me.id).maybeSingle();
      if (referrer) {
        await db
          .from('profiles')
          .update({ referred_by: referrer.id, trial_ends_at: new Date(Date.now() + REFERRAL_TRIAL_DAYS * 86400_000).toISOString() })
          .eq('id', me.id);
      }
    }
    store.delete('ref');
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
