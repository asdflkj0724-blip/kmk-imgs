import type { Metadata } from 'next';
import Link from 'next/link';
import '../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { POSTS } from '@/lib/content/posts';

export const metadata: Metadata = {
  title: 'ブログ',
  description: 'タオバオ仕入れ・BUYMA出品のやり方や、価格の決め方などを紹介します。',
};

export default function BlogIndex() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <h1>ブログ</h1>
        <ul className="post-list">
          {POSTS.map((p) => (
            <li key={p.slug} className="card">
              <Link href={`/blog/${p.slug}`}>
                <h2>{p.title}</h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {p.date}　{p.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
