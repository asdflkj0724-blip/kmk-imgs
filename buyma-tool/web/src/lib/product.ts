/**
 * 拡張機能から送られてくる商品データの形（extension/src/extractor.js の出力）。
 */
import { z } from 'zod';

export const ProductSchema = z.object({
  source: z.string().max(20).default('unknown'),
  itemId: z.string().max(40).default(''),
  url: z.string().max(2000).default(''),
  title: z.string().max(500).default(''),
  price: z
    .object({ min: z.number(), max: z.number(), currency: z.string().max(5).default('CNY'), raw: z.string().max(100).default('') })
    .nullable()
    .default(null),
  skus: z
    .array(
      z.object({
        name: z.string().max(100),
        values: z.array(z.object({ name: z.string().max(200), image: z.string().max(2000).default(''), disabled: z.boolean().default(false) })).max(200),
      })
    )
    .max(10)
    .default([]),
  specs: z.array(z.object({ name: z.string().max(100), value: z.string().max(500) })).max(100).default([]),
  images: z.array(z.string().max(2000)).max(50).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

/** SKU の中から色とサイズらしいものを取り出す */
export function colorsAndSizes(p: Pick<Product, 'skus'>): { colors: string[]; sizes: string[] } {
  const colors: string[] = [];
  const sizes: string[] = [];
  for (const g of p.skus) {
    const names = g.values.map((v) => v.name);
    if (/颜色|色|color|colour|カラー/i.test(g.name)) colors.push(...names);
    else if (/尺码|尺寸|サイズ|size|码/i.test(g.name)) sizes.push(...names);
  }
  return { colors, sizes };
}

/** 偽物チェック用に、仕入れ元の文章を1つにまとめる */
export function sourceText(p: Product): string {
  return [p.title, ...p.specs.map((s) => `${s.name} ${s.value}`)].join('\n');
}
