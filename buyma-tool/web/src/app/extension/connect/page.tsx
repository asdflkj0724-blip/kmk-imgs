import type { Metadata } from 'next';
import { ConnectExtension } from './ConnectExtension';
import { siteUrl } from '@/lib/http';

export const metadata: Metadata = { title: '拡張機能とつなぐ', robots: { index: false } };

export default function ConnectPage() {
  return (
    <main className="container" style={{ maxWidth: 560, padding: '48px 16px' }}>
      <h1>拡張機能とつなぐ</h1>
      <p>Chrome 拡張から、このアカウントで AI の文章作成などを使えるようにします。</p>
      <ConnectExtension extensionId={process.env.NEXT_PUBLIC_EXTENSION_ID || ''} apiBase={siteUrl()} />
    </main>
  );
}
