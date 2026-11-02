import Link from 'next/link';
import type { Metadata } from 'next';
import { SERVICE_NAME } from '@/lib/brand';
import './dashboard.css';

export const metadata: Metadata = { title: '管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/dashboard', label: 'ホーム' },
  { href: '/dashboard/listings', label: '出品履歴' },
  { href: '/dashboard/templates', label: 'テンプレート' },
  { href: '/dashboard/settings', label: '価格の設定' },
  { href: '/dashboard/billing', label: 'プラン・お支払い' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dash">
      <header className="dash-header">
        <div className="container dash-header-inner">
          <Link href="/dashboard" className="dash-logo">
            {SERVICE_NAME}
          </Link>
          <nav className="dash-nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
          <form action="/auth/signout" method="post">
            <button className="dash-signout">ログアウト</button>
          </form>
        </div>
      </header>
      <main className="container dash-main">{children}</main>
    </div>
  );
}
