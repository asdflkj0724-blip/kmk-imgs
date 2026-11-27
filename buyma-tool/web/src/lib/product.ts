/**
 * 拡張機能から送られてくる商品データの形（extension/src/extractor.js の出力）。
 */
import { z } from 'zod';

export const ProductSchema = z.object({
  source: z.string().max(100).default('unknown'),
  itemId: z.string().max(40).default(''),
  url: z.string().max(2000).default(''),
  title: z.string().max(500).default(''),
  /** お店の名前（天猫の「○○旗舰店」なら、そのブランドの公式店） */
  shopName: z.string().max(100).default(''),
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

/**
 * はっきりわかるブランド名。
 *  - 公式の旗艦店（「○○旗舰店」「○○官方店」など）なら、お店の名前から「旗舰店」を外したもの
 *  - 仕様に「品牌（ブランド）」があれば、その値
 * どちらもなければ空文字（「同款」「大牌」は○○風の意味なので、ブランドとはみなさない）
 */
export function knownBrand(p: Pick<Product, 'shopName' | 'specs'>): string {
  const spec = (p.specs || []).find((s) => /^(品牌|ブランド|brand)$/i.test(s.name.trim()));
  const fromSpec = spec ? spec.value.replace(/[（(].*?[)）]/g, '').trim() : '';
  if (fromSpec && !/同款|大牌|无|無|其他|other/i.test(fromSpec)) return fromSpec.slice(0, 40);
  const m = (p.shopName || '').trim().match(/^(.+?)(?:官方)?(?:旗舰店|旗艦店|官方店|官方旗舰店)$/);
  return m ? m[1].trim().slice(0, 40) : '';
}

/** 商品名の先頭にブランド名を置く（すでに先頭にあれば、そのまま） */
export function withBrandFirst(title: string, brand: string): string {
  const b = brand.trim();
  const t = title.trim();
  if (!b) return t;
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (norm(t).startsWith(norm(b))) return t;
  // ほかの位置に入っていたら外してから先頭へ
  const rest = t.replace(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/\s{2,}/g, ' ').trim();
  return `${b} ${rest}`.trim();
}
