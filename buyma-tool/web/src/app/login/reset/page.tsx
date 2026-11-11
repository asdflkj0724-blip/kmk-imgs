import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from './ResetForm';
import { SERVICE_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: 'パスワードの設定・再設定' };

export default function ResetPage() {
  return (
    <main className="container" style={{ maxWidth: 440, padding: '48px 16px' }}>
      <p>
        <Link href="/" style={{ textDecoration: 'none', fontWeight: 700 }}>
          {SERVICE_NAME}
        </Link>
      </p>
      <ResetForm />
    </main>
  );
}
