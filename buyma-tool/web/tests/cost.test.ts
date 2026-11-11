import { describe, expect, it } from 'vitest';
import { costUsd, planMargins } from '@/lib/cost';

describe('cost', () => {
  it('トークン数から費用を出す（Sonnet: 入力 $2 / 出力 $10 per 100万）', () => {
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2);
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.014);
  });
  it('上限まで使われたときのプランごとの粗利', () => {
    const m = planMargins(0.014, 155);
    const light = m.find((x) => x.plan === 'ライト')!;
    expect(light.aiCostJpyAtLimit).toBe(217);
    expect(light.ok).toBe(true);
  });
});
