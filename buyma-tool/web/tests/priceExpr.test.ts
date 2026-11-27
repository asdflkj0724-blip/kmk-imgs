import { describe, expect, it } from 'vitest';
import { evalPriceExpr, normalizePriceExpr, priceExprError } from '@/lib/priceExpr';

describe('販売価格の計算式', () => {
  it('x（表示価格）を省いた書き方もそのまま使える', () => {
    expect(normalizePriceExpr('×1.3+2000')).toBe('x*1.3+2000');
    expect(normalizePriceExpr('+3000')).toBe('x+3000');
    expect(normalizePriceExpr('3000')).toBe('x+3000');
    expect(normalizePriceExpr('＊１．２＋１，５００')).toBe('x*1.2+1500');
    expect(normalizePriceExpr('表示価格×1.1+500円')).toBe('x*1.1+500');
  });
  it('かけ算・わり算を先に計算する', () => {
    expect(evalPriceExpr('×1.3+2000', 5000)).toBe(8500);
    expect(evalPriceExpr('(x+500)×1.2', 5000)).toBe(6600);
    expect(evalPriceExpr('x÷0.8', 4000)).toBe(5000);
    expect(evalPriceExpr('+3000', 4279)).toBe(7279);
  });
  it('使えない文字やおかしな式はエラーにする（プログラムとしては実行しない）', () => {
    expect(priceExprError('alert(1)')).toMatch(/使えない文字/);
    expect(priceExprError('x+')).toMatch(/途中/);
    expect(priceExprError('(x+1')).toMatch(/かっこ/);
    expect(priceExprError('x/0')).toMatch(/0 で割る/);
    expect(priceExprError('×1.3+2000')).toBeNull();
  });
});
