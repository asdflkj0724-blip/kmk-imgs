/**
 * 出品データの CSV。Excel で文字化けしないよう、先頭に BOM を付けた UTF-8 にする。
 */
export interface ListingRow {
  id: string;
  title_ja: string | null;
  description_ja: string | null;
  price_jpy: number | null;
  cost_cny: number | null;
  cost_currency?: string | null;
  fx_rate: number | null;
  source_url: string | null;
  item_id: string | null;
  colors: string[];
  sizes: string[];
  image_count: number;
  status: string;
  created_at: string;
}

export const CSV_COLUMNS: { key: string; label: string; get: (r: ListingRow) => string | number | null }[] = [
  { key: 'title', label: '商品名', get: (r) => r.title_ja },
  { key: 'description', label: '商品コメント', get: (r) => r.description_ja },
  { key: 'price', label: '販売価格（円）', get: (r) => r.price_jpy },
  { key: 'colors', label: '色', get: (r) => r.colors.join('/') },
  { key: 'sizes', label: 'サイズ', get: (r) => r.sizes.join('/') },
  { key: 'images', label: '画像ファイル', get: (r) => imageFileNames(r.item_id || r.id, r.image_count).join(';') },
  { key: 'cost', label: '仕入れ値', get: (r) => r.cost_cny },
  { key: 'currency', label: '通貨', get: (r) => r.cost_currency ?? 'CNY' },
  { key: 'fx', label: '為替レート', get: (r) => r.fx_rate },
  { key: 'url', label: '仕入れ先URL', get: (r) => r.source_url },
  { key: 'status', label: '状態', get: (r) => STATUS_LABELS[r.status] || r.status },
  { key: 'created', label: '作成日', get: (r) => r.created_at.slice(0, 10) },
];

/** BUYMA への登録はユーザー本人が行う（半自動）ので、状態は「下書き」と「出品済み」だけ */
export const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  listed: '出品済み',
};

/** 拡張機能の画像 ZIP と同じ名前の付け方（taobao_123_01.jpg） */
export function imageFileNames(base: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `taobao_${base}_${String(i + 1).padStart(2, '0')}.jpg`);
}

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // 表計算ソフトで数式として動かないようにする
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: ListingRow[]): string {
  const lines = [CSV_COLUMNS.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(c.get(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
