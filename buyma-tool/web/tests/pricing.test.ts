import { describe, expect, it } from 'vitest';
import { calculatePrice, DEFAULT_PRICING, mergeSettings, validateSettings, type PricingSettings } from '@/lib/pricing';

const base: PricingSettings = {
  ...DEFAULT_PRICING,
  fxMarkupRate: 0,
  agentFeeRate: 0,
  domesticShippingCny: 0,
  internationalShippingJpy: 1000,
  otherCostJpy: 0,
  dutyRate: 0,
  buymaFeeRate: 0.1,
  profitMode: 'margin',
  profitRate: 0.2,
  minProfitJpy: 0,
  roundTo: 100,
};

describe('calculatePrice', () => {
  it('売値に対する利益率で計算する', () => {
    // 費用 = 100元×20円 + 1000 = 3000。売値 = 3000 / (1-0.1-0.2) = 4285.7 → 4300
    const r = calculatePrice(100, 20, base);
    expect(r.totalCostJpy).toBe(3000);
    expect(r.salePriceJpy).toBe(4300);
    expect(r.buymaFeeJpy).toBe(430);
    expect(r.profitJpy).toBe(870);
  });

  it('費用に対する上乗せ率で計算する', () => {
    // 3000 × 1.2 / 0.9 = 4000
    const r = calculatePrice(100, 20, { ...base, profitMode: 'markup' });
    expect(r.salePriceJpy).toBe(4000);
    expect(r.profitJpy).toBe(600);
  });

  it('最低利益を下回らないようにする', () => {
    const r = calculatePrice(10, 20, { ...base, internationalShippingJpy: 0, minProfitJpy: 1000 });
    expect(r.profitJpy).toBeGreaterThanOrEqual(1000);
  });

  it('為替の上乗せ・代行手数料・国内送料・関税を足す', () => {
    const r = calculatePrice(100, 20, {
      ...base,
      fxMarkupRate: 0.05,
      agentFeeRate: 0.1,
      domesticShippingCny: 10,
      dutyRate: 0.1,
      internationalShippingJpy: 0,
    });
    expect(r.effectiveFxRate).toBe(21);
    expect(r.productJpy).toBe(2100);
    expect(r.agentFeeJpy).toBe(210);
    expect(r.domesticShippingJpy).toBe(210);
    expect(r.dutyJpy).toBe(210);
    expect(r.totalCostJpy).toBe(2730);
  });

  it('おかしな値は計算しない', () => {
    expect(() => calculatePrice(0, 20, base)).toThrow();
    expect(() => calculatePrice(100, 0, base)).toThrow();
    expect(() => calculatePrice(100, 20, { ...base, profitRate: 0.9 })).toThrow();
  });

  it('保存された設定の一部だけを上書きし、変な値は無視する', () => {
    const m = mergeSettings({ profitRate: 0.3, profitMode: 'bogus' as never, roundTo: NaN });
    expect(m.profitRate).toBe(0.3);
    expect(m.profitMode).toBe(DEFAULT_PRICING.profitMode);
    expect(m.roundTo).toBe(DEFAULT_PRICING.roundTo);
    expect(validateSettings(DEFAULT_PRICING)).toEqual([]);
  });
});
