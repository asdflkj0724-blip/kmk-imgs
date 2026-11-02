import type { Metadata } from 'next';
import './globals.css';
import { CATCHCOPY, SERVICE_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: `${SERVICE_NAME}｜${CATCHCOPY}`, template: `%s｜${SERVICE_NAME}` },
  description: 'タオバオのページでボタンを1回押すだけで、BUYMA用の日本語タイトル・説明文・販売価格ができあがる出品支援ツール。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
