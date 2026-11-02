import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getProfile } from '@/lib/account';

/** 管理画面の各ページの最初に呼ぶ：ログイン中のユーザーとプロフィール */
export async function requireSession() {
  const { data } = await (await supabaseServer()).auth.getUser();
  if (!data.user) redirect('/login?next=/dashboard');
  const profile = await getProfile(data.user.id);
  return { user: data.user, profile };
}
