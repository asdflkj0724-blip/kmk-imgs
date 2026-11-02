import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { POSTS, getPost, type Block } from '@/lib/content/posts';
import { TRIAL_DAYS } from '@/lib/plans';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  return { title: post.title, description: post.description, openGraph: { title: post.title, description: post.description, type: 'article' } };
}

function render(b: Block, i: number) {
  switch (b.type) {
    case 'h2':
      return <h2 key={i}>{b.text}</h2>;
    case 'h3':
      return <h3 key={i}>{b.text}</h3>;
    case 'p':
      return <p key={i}>{b.text}</p>;
    case 'ul':
      return (
        <ul key={i}>
          {b.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i}>
          {b.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      );
  }
}

export default async function PostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <p className="small">
          <Link href="/blog">← ブログ一覧</Link>
        </p>
        <article>
          <h1>{post.title}</h1>
          <p className="small muted">{post.date}</p>
          {post.blocks.map(render)}
        </article>
        <div className="cta-band" style={{ marginTop: 40 }}>
          <h2>出品作業を1件3分に</h2>
          <p>タオバオのページでボタンを1回押すだけ。{TRIAL_DAYS}日間 無料で試せます。</p>
          <Link href="/login?mode=signup" className="btn">
            無料お試しに登録する
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
