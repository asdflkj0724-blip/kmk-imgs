import Link from 'next/link';
import { SERVICE_NAME } from '@/lib/brand';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <nav className="site-footer-links" aria-label="フッターメニュー">
          <Link href="/legal/tokushoho">特定商取引法に基づく表記</Link>
          <Link href="/legal/terms">利用規約</Link>
          <Link href="/legal/privacy">プライバシーポリシー</Link>
          <Link href="/contact">お問い合わせ</Link>
          <Link href="/guide">無料ガイド</Link>
          <Link href="/blog">ブログ</Link>
          <Link href="/faq">よくある質問</Link>
          <Link href="/login">ログイン</Link>
        </nav>
        <p className="small muted">本サービスはBUYMA・タオバオ・天猫その他の通販サイトの公式ツールではありません。</p>
        <p className="small muted">© {new Date().getFullYear()} {SERVICE_NAME}</p>
      </div>
    </footer>
  );
}
