import Link from 'next/link';
import { SERVICE_NAME } from '@/lib/brand';

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="site-logo">
          {SERVICE_NAME}
        </Link>
        <nav className="site-nav" aria-label="メインメニュー">
          <Link href="/#features">機能</Link>
          <Link href="/#pricing">料金</Link>
          <Link href="/faq">よくある質問</Link>
          <Link href="/blog">ブログ</Link>
          <Link href="/login">ログイン</Link>
          <Link href="/login?mode=signup" className="btn site-nav-cta">
            無料で試す
          </Link>
        </nav>
      </div>
    </header>
  );
}
