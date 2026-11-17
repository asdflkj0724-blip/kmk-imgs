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
  it('ブランド名と規約に触れやすい言葉は注意（誇大表現は autoFixText で自動で消す）', () => {
    const issues = checkListing({ title: 'GUCCI風 バッグ 送料無料', description: '' });
    expect(issues.some((i) => i.word === 'GUCCI' && i.level === 'warning')).toBe(true);
    expect(issues.some((i) => i.word === '送料無料')).toBe(true);
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

describe('誇大表現の自動修正', async () => {
  const { autoFixText, checkListing } = await import('@/lib/listingRules');
  it('根拠のない「高級」「最高級」などを消し、消したものを返す', () => {
    const r = autoFixText('【最高級】高級ウール ワイドパンツ 大人気', true);
    expect(r.text).toBe('ウール ワイドパンツ');
    expect(r.removed).toEqual(expect.arrayContaining(['最高級', '高級', '大人気']));
  });
  it('見た目の説明の「高級感」は残す', () => {
    const r = autoFixText('高級感のある光沢が特徴です。高品質な生地を使っています。');
    expect(r.text).toBe('高級感のある光沢が特徴です。生地を使っています。');
    expect(r.removed).toEqual(['高品質']);
  });
  it('素材の「100%」では警告しない', () => {
    expect(checkListing({ title: 'ウール ニット', description: '【素材】\nウール100%' })).toEqual([]);
  });
});

describe('BUYMA の数え方（半角換算）', async () => {
  const { charLength, fitTitle, checkListing } = await import('@/lib/listingRules');
  it('半角は1、全角は2として数える', () => {
    expect(charLength('ABC 123')).toBe(7);
    expect(charLength('ウールコート')).toBe(12);
    expect(charLength('ｳｰﾙ')).toBe(3); // 半角カナ
  });
  it('日本語の商品名は30文字（半角60）までに収める', () => {
    const t = fitTitle('ダブルフェイス ウール ロングコート キャメル 秋冬 きれいめ アウター レディース');
    expect(charLength(t)).toBeLessThanOrEqual(60);
    expect(t.startsWith('ダブルフェイス ウール')).toBe(true);
  });
  it('全角31文字は長すぎる', () => {
    const issues = checkListing({ title: 'あ'.repeat(31), description: '' });
    expect(issues.some((i) => i.level === 'error' && i.message.includes('全角30文字'))).toBe(true);
  });
});
