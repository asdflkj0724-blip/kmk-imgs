import { describe, expect, it } from 'vitest';
import { knownBrand, withBrandFirst } from '@/lib/product';

describe('ブランド名を商品名の先頭に', () => {
  it('公式の旗艦店なら、お店の名前からブランドがわかる', () => {
    expect(knownBrand({ shopName: 'mamc旗舰店', specs: [] })).toBe('mamc');
    expect(knownBrand({ shopName: 'MAMC官方旗舰店', specs: [] })).toBe('MAMC');
    expect(knownBrand({ shopName: '小红的店', specs: [] })).toBe('');
  });
  it('仕様の「品牌」もブランドとして使う。「同款」などは使わない', () => {
    expect(knownBrand({ shopName: '', specs: [{ name: '品牌', value: 'MAMC' }] })).toBe('MAMC');
    expect(knownBrand({ shopName: '', specs: [{ name: '品牌', value: '大牌同款' }] })).toBe('');
  });
  it('先頭にブランド名を置く（すでにあればそのまま、途中にあれば先頭へ）', () => {
    expect(withBrandFirst('モヘア混 カーディガン', 'MAMC')).toBe('MAMC モヘア混 カーディガン');
    expect(withBrandFirst('mamc モヘア混 カーディガン', 'MAMC')).toBe('mamc モヘア混 カーディガン');
    expect(withBrandFirst('モヘア混 MAMC カーディガン', 'MAMC')).toBe('MAMC モヘア混 カーディガン');
    expect(withBrandFirst('モヘア混 カーディガン', '')).toBe('モヘア混 カーディガン');
  });
});
