import Link from 'next/link';
import { SERVICE_NAME } from '@/lib/brand';
import { SITE } from '@/site.config';

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="site-logo">
          {SERVICE_NAME}
        </Link>
        <nav className="site-nav" aria-label="メインメニュー">
          <Link href="/#features" className="nav-wide">機能</Link>
          <Link href="/#pricing" className="nav-wide">料金</Link>
          <Link href="/faq" className="nav-wide">よくある質問</Link>
          <Link href="/blog" className="nav-wide">ブログ</Link>
          <Link href="/login" className="nav-login">ログイン</Link>
          <Link href={SITE.launchMode === 'waitlist' ? '/#signup' : '/login?mode=signup'} className="btn site-nav-cta">
            無料お試し
          </Link>
        </nav>
      </div>
    </header>
  );
}
