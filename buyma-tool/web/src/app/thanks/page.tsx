import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import '../marketing.css';

export const metadata: Metadata = { title: 'お申し込みありがとうございます', robots: { index: false } };

export default function ThanksPage() {
  return (
    <>
      <SiteHeader />
      <main className="container" style={{ maxWidth: 640, padding: '48px 16px' }}>
        <h1>お申し込みありがとうございます</h1>
        <p>お支払いが完了しました。Stripe から領収のメールが届きます。</p>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>はじめに、パスワードを決めてください</h2>
          <ol>
            <li>下のボタンから、お申し込みに使ったメールアドレスを入れます</li>
            <li>届いたメールのリンクを開き、パスワードを決めます</li>
            <li>管理画面にログインしたら、「拡張機能とつなぐ」から使い始められます</li>
          </ol>
          <p>
            <Link href="/login/reset" className="btn">
              パスワードを決める
            </Link>
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Google アカウントで同じメールアドレスをお使いの場合は、<Link href="/login">ログイン画面</Link>の「Googleでログイン」からも入れます。
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
