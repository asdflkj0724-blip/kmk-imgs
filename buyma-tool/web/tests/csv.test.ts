import { describe, expect, it } from 'vitest';
import { csvCell, imageFileNames, toCsv } from '@/lib/csv';

describe('csv', () => {
  it('カンマ・改行・引用符を正しく囲む', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('1行目\n2行目')).toBe('"1行目\n2行目"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });
  it('数式として動かないようにする', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(-5)).toBe('-5');
  });
  it('BOM 付きで見出しと行を出す', () => {
    const csv = toCsv([
      {
        id: 'x', title_ja: 'コート', description_ja: '説明', price_jpy: 9800, cost_cny: 199, fx_rate: 21.5,
        source_url: 'https://item.taobao.com/item.htm?id=1', item_id: '1', colors: ['キャメル', 'ブラック'], sizes: ['S'],
        image_count: 2, status: 'queued', created_at: '2026-11-02T00:00:00Z',
      },
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0].startsWith('商品名,商品コメント,販売価格（円）')).toBe(true);
    expect(lines[1]).toContain('キャメル/ブラック');
    expect(lines[1]).toContain('taobao_1_01.jpg;taobao_1_02.jpg');
    expect(lines[1]).toContain('出品待ち');
  });
  it('画像の名前は拡張機能の ZIP と同じ', () => {
    expect(imageFileNames('123', 3)).toEqual(['taobao_123_01.jpg', 'taobao_123_02.jpg', 'taobao_123_03.jpg']);
  });
});
