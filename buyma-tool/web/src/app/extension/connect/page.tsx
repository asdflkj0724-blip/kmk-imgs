import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConnectExtension } from './ConnectExtension';
import { siteUrl } from '@/lib/http';
import { supabaseServer } from '@/lib/supabase/server';
import { accountActive, getProfile } from '@/lib/account';

export const metadata: Metadata = { title: '拡張機能とつなぐ', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function ConnectPage() {
  const { data } = await (await supabaseServer()).auth.getUser();
  if (!data.user) redirect('/login?next=/extension/connect');
  // 購入者（またはお試し中の人）にだけ、拡張機能へログイン情報を渡す
  const active = accountActive(await getProfile(data.user.id));
  return (
    <main className="container" style={{ maxWidth: 560, padding: '48px 16px' }}>
      <h1>拡張機能とつなぐ</h1>
      {active ? (
        <>
          <p>Chrome 拡張から、このアカウントで出品データの作成などを使えるようにします。</p>
          <ConnectExtension extensionId={process.env.NEXT_PUBLIC_EXTENSION_ID || ''} apiBase={siteUrl()} />
        </>
      ) : (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            無料お試しの期間が終わったか、プランのお支払いが止まっています。拡張機能を使うには、プランにお申し込みください。
          </p>
          <Link href="/dashboard/billing" className="btn">
            プランを見る
          </Link>
        </div>
      )}
    </main>
  );
}
