import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/http';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/dashboard', '/api/', '/extension/', '/guide/read'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
