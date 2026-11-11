import type { Metadata } from 'next';
import Link from 'next/link';
import '../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import ContactForm from './ContactForm';
import { SITE } from '@/site.config';

export const metadata: Metadata = { title: 'お問い合わせ' };

export default function ContactPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>お問い合わせ</h1>
        <p>
          ご質問・ご要望・月{SITE.customAbove.toLocaleString('ja-JP')}件を超えるご利用のご相談などは、こちらからお送りください。先に<Link href="/faq">よくある質問</Link>もご覧ください。
        </p>
        <ContactForm />
      </main>
      <SiteFooter />
    </>
  );
}
