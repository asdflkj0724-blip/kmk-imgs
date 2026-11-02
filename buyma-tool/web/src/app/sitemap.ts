import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/http';
import { POSTS } from '@/lib/content/posts';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages = ['', '/faq', '/guide', '/blog', '/contact', '/legal/tokushoho', '/legal/terms', '/legal/privacy'];
  return [
    ...pages.map((p) => ({ url: `${base}${p}`, changeFrequency: 'monthly' as const, priority: p === '' ? 1 : 0.6 })),
    ...POSTS.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.date, changeFrequency: 'monthly' as const, priority: 0.7 })),
  ];
}
