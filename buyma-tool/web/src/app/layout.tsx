import type { Metadata } from 'next';
import './globals.css';
import { SERVICE_NAME } from '@/lib/brand';
import { SITE } from '@/site.config';

export const metadata: Metadata = {
  title: { default: `${SERVICE_NAME}｜${SITE.seoTitle}`, template: `%s｜${SERVICE_NAME}` },
  keywords: [...SITE.keywords],
  openGraph: { title: `${SERVICE_NAME}｜${SITE.seoTitle}`, description: SITE.description, type: 'website', locale: 'ja_JP', siteName: SERVICE_NAME },
  description: SITE.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
