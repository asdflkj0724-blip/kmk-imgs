import type { Metadata } from 'next';
import './globals.css';
import { CATCHCOPY, SERVICE_NAME } from '@/lib/brand';
import { SITE } from '@/site.config';

export const metadata: Metadata = {
  title: { default: `${SERVICE_NAME}｜${CATCHCOPY}`, template: `%s｜${SERVICE_NAME}` },
  description: SITE.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
