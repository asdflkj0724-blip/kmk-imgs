import { describe, expect, it } from 'vitest';
import { chooseRate, fetchRates, isSaneRate, normalizeCurrency } from '@/lib/fx';

describe('為替（通貨ごと）', () => {
  it('円から見たレートを「1単位＝何円」に直し、おかしな値は捨てる', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ date: '2026-11-04', rates: { CNY: 0.0465, KRW: 9.1, USD: 0.0066, EUR: 0.0061, GBP: 0.0052, HKD: 99 } }))) as typeof fetch;
    const q = await fetchRates(fake);
    const by = Object.fromEntries(q.map((x) => [x.currency, x.rate]));
    expect(by.CNY).toBeCloseTo(21.505, 2);
    expect(by.KRW).toBeCloseTo(0.10989, 4);
    expect(by.USD).toBeCloseTo(151.5, 0);
    expect(by.HKD).toBeUndefined(); // 1香港ドル＝0.01円 はありえないので使わない
  });
  it('固定レート → 自動レート の順、円はそのまま', () => {
    const latest = { currency: 'KRW' as const, rate: 0.11, date: '2026-11-04', source: 'x' };
    expect(chooseRate('KRW', { KRW: 0.105 }, latest)).toMatchObject({ rate: 0.105, source: 'fixed' });
    expect(chooseRate('KRW', {}, latest)).toMatchObject({ rate: 0.11, source: 'daily' });
    expect(chooseRate('TWD', {}, null)).toBeNull();
    expect(chooseRate('JPY', {}, null)).toMatchObject({ rate: 1 });
  });
  it('通貨の書き方のゆれを直す', () => {
    expect(normalizeCurrency('rmb')).toBe('CNY');
    expect(normalizeCurrency('₩')).toBe('KRW');
    expect(normalizeCurrency('eur')).toBe('EUR');
    expect(normalizeCurrency('BTC')).toBeNull();
    expect(isSaneRate('CNY', 21)).toBe(true);
    expect(isSaneRate('CNY', 0.5)).toBe(false);
  });
});
