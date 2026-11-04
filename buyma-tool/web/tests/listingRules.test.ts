import { describe, expect, it } from 'vitest';
import { charLength, checkListing, fitTitle, TITLE_MAX } from '@/lib/listingRules';

describe('fitTitle', () => {
  it('短ければそのまま', () => {
    expect(fitTitle('  ウール  コート ')).toBe('ウール コート');
  });
  it('長ければ上限以内で区切りのところで切る', () => {
    const long = '【2024新作】ダブルフェイス ウール ロングコート ' + 'あ'.repeat(80);
    const t = fitTitle(long);
    expect(charLength(t)).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.startsWith('【2024新作】')).toBe(true);
  });
});

describe('checkListing', () => {
  it('偽物を思わせる言葉はエラー', () => {
    const issues = checkListing({ title: 'スーパーコピー バッグ', description: '' });
    expect(issues.some((i) => i.level === 'error' && i.word === 'スーパーコピー')).toBe(true);
  });
  it('仕入れ元の「高仿」「同款」を見つける', () => {
    const issues = checkListing({ title: 'バッグ', description: '説明', sourceText: '高仿 大牌同款 包包' });
    expect(issues.some((i) => i.field === 'source' && i.word === '高仿' && i.level === 'error')).toBe(true);
    expect(issues.some((i) => i.field === 'source' && i.word === '同款')).toBe(true);
  });
  it('ブランド名と誇大表現は注意', () => {
    const issues = checkListing({ title: 'GUCCI風 激安 バッグ', description: '' });
    expect(issues.some((i) => i.word === 'GUCCI' && i.level === 'warning')).toBe(true);
    expect(issues.some((i) => i.word === '激安')).toBe(true);
  });
  it('問題がなければ空', () => {
    expect(checkListing({ title: 'ウール ロングコート キャメル', description: '柔らかい手触りです。' })).toEqual([]);
  });
});

describe('中国語の文字のチェック', () => {
  it('簡体字が残っていたら知らせる', () => {
    const issues = checkListing({ title: 'ウールコート 均码', description: '颜色はキャメルです。' });
    expect(issues.some((i) => i.field === 'title' && i.message.includes('码'))).toBe(true);
    expect(issues.some((i) => i.field === 'description' && i.message.includes('颜'))).toBe(true);
  });
  it('日本語でも使う漢字では知らせない', () => {
    expect(checkListing({ title: '本革 ショルダーバッグ 黒', description: '柔らかい牛革を使ったバッグです。色はブラックです。' })).toEqual([]);
  });
});

it('番号・時刻・服装・定款のような日本語の漢字は知らせない', async () => {
  const { findSimplifiedChinese } = await import('@/lib/listingRules');
  expect(findSimplifiedChinese('品番号 時刻 服装 定款 個数')).toEqual([]);
});
