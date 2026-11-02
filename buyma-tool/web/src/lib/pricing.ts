/**
 * 販売価格の計算。
 * 仕入れ値（人民元）× 為替 ＋ 送料などの費用 に、BUYMA の手数料と利益を乗せる。
 *
 * 利益の付け方は2通り：
 *  - margin（売値に対する利益率）: 売値 = 費用 ÷ (1 − 手数料率 − 利益率)
 *  - markup（費用に対する上乗せ率）: 売値 = 費用 × (1 + 上乗せ率) ÷ (1 − 手数料率)
 */
export interface PricingSettings {
  /** 為替の上乗せ（カード手数料などの分）。0.03 = 3% */
  fxMarkupRate: number;
  /** 仕入れ先の国内送料（人民元） */
  domesticShippingCny: number;
  /** 代行業者の手数料率。0.05 = 5% */
  agentFeeRate: number;
  /** 国際送料（円） */
  internationalShippingJpy: number;
  /** その他の固定費（梱包など、円） */
  otherCostJpy: number;
  /** 関税・消費税の見込み（仕入れ値に対する率）。関税込みで売る場合に使う */
  dutyRate: number;
  /** BUYMA の成約手数料率（仮の値。必ず自分の契約の率に直す） */
  buymaFeeRate: number;
  profitMode: 'margin' | 'markup';
  /** margin なら売値に対する率、markup なら費用に対する率 */
  profitRate: number;
  /** 最低利益（円）。率で計算した利益がこれより少なければこちらを使う */
  minProfitJpy: number;
  /** 端数の切り上げ単位（10, 100 など） */
  roundTo: number;
}

export const DEFAULT_PRICING: PricingSettings = {
  fxMarkupRate: 0.03,
  domesticShippingCny: 0,
  agentFeeRate: 0.05,
  internationalShippingJpy: 1500,
  otherCostJpy: 0,
  dutyRate: 0,
  buymaFeeRate: 0.077,
  profitMode: 'margin',
  profitRate: 0.2,
  minProfitJpy: 1000,
  roundTo: 100,
};

export interface PriceBreakdown {
  costCny: number;
  fxRate: number;
  effectiveFxRate: number;
  productJpy: number;
  agentFeeJpy: number;
  domesticShippingJpy: number;
  dutyJpy: number;
  internationalShippingJpy: number;
  otherCostJpy: number;
  totalCostJpy: number;
  salePriceJpy: number;
  buymaFeeJpy: number;
  profitJpy: number;
  profitRateOfSale: number;
}

export function validateSettings(s: PricingSettings): string[] {
  const errors: string[] = [];
  const rates: (keyof PricingSettings)[] = ['fxMarkupRate', 'agentFeeRate', 'dutyRate', 'buymaFeeRate', 'profitRate'];
  for (const k of rates) {
    const v = s[k] as number;
    if (!Number.isFinite(v) || v < 0 || v >= 1.5) errors.push(`${k} は 0 以上の率で入れてください（例：20% → 0.2）`);
  }
  if (s.profitMode === 'margin' && s.buymaFeeRate + s.profitRate >= 0.95) {
    errors.push('手数料率と利益率の合計が大きすぎます（95% 未満にしてください）');
  }
  if (!(s.roundTo >= 1)) errors.push('切り上げ単位は 1 以上にしてください');
  return errors;
}

const yen = (n: number) => Math.round(n);

export function calculatePrice(costCny: number, fxRate: number, settings: PricingSettings): PriceBreakdown {
  if (!(costCny > 0)) throw new Error('仕入れ値（人民元）が正しくありません');
  if (!(fxRate > 0)) throw new Error('為替レートが正しくありません');
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join(' / '));

  const s = settings;
  const effectiveFxRate = fxRate * (1 + s.fxMarkupRate);
  const productJpy = costCny * effectiveFxRate;
  const agentFeeJpy = productJpy * s.agentFeeRate;
  const domesticShippingJpy = s.domesticShippingCny * effectiveFxRate;
  const dutyJpy = productJpy * s.dutyRate;
  const totalCost = productJpy + agentFeeJpy + domesticShippingJpy + dutyJpy + s.internationalShippingJpy + s.otherCostJpy;

  let sale =
    s.profitMode === 'margin'
      ? totalCost / (1 - s.buymaFeeRate - s.profitRate)
      : (totalCost * (1 + s.profitRate)) / (1 - s.buymaFeeRate);

  // 最低利益を下回るなら、最低利益が残る値段まで上げる
  const minSale = (totalCost + s.minProfitJpy) / (1 - s.buymaFeeRate);
  if (sale < minSale) sale = minSale;

  const salePriceJpy = Math.ceil(sale / s.roundTo) * s.roundTo;
  const buymaFeeJpy = salePriceJpy * s.buymaFeeRate;
  const profitJpy = salePriceJpy - buymaFeeJpy - totalCost;

  return {
    costCny,
    fxRate,
    effectiveFxRate: Math.round(effectiveFxRate * 10000) / 10000,
    productJpy: yen(productJpy),
    agentFeeJpy: yen(agentFeeJpy),
    domesticShippingJpy: yen(domesticShippingJpy),
    dutyJpy: yen(dutyJpy),
    internationalShippingJpy: s.internationalShippingJpy,
    otherCostJpy: s.otherCostJpy,
    totalCostJpy: yen(totalCost),
    salePriceJpy,
    buymaFeeJpy: yen(buymaFeeJpy),
    profitJpy: yen(profitJpy),
    profitRateOfSale: Math.round((profitJpy / salePriceJpy) * 1000) / 1000,
  };
}

/** 保存された設定（一部だけのこともある）を既定値と合わせる */
export function mergeSettings(partial: Partial<PricingSettings> | null | undefined): PricingSettings {
  const merged = { ...DEFAULT_PRICING };
  if (partial) {
    for (const k of Object.keys(DEFAULT_PRICING) as (keyof PricingSettings)[]) {
      const v = partial[k];
      if (v === undefined || v === null) continue;
      if (k === 'profitMode') {
        if (v === 'margin' || v === 'markup') merged.profitMode = v;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        (merged[k] as number) = v;
      }
    }
  }
  return merged;
}
