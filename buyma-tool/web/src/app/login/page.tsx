import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { SERVICE_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: 'ログイン・無料登録' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="container" style={{ maxWidth: 440, padding: '48px 16px' }}>
      <p>
        <Link href="/" style={{ textDecoration: 'none', fontWeight: 700 }}>
          {SERVICE_NAME}
        </Link>
      </p>
      <LoginForm initialMode={sp.mode === 'signup' ? 'signup' : 'login'} next={sp.next} refCode={sp.ref} error={sp.error} />
    </main>
  );
}
