/**
 * export.js
 * ============================================================
 * 保存した商品データを JSON / CSV ファイルとして
 * ダウンロードするためのファイル。
 *
 * 将来「Googleスプレッドシート連携」などを作るときも、
 * ここに関数を足していくイメージです。
 * ============================================================
 */

/** 文字列をファイルとしてダウンロードさせる共通処理 */
function downloadTextFile(filename, text, mimeType) {
  try {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    console.error('[MAMC取り込み] ダウンロードに失敗:', e);
    alert('ファイルのダウンロードに失敗しました: ' + e.message);
  }
}

/** 今日の日付入りのファイル名を作る（例: mamc-products-2026-09-12） */
function exportFileName(ext) {
  const d = new Date();
  const ymd = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  return 'mamc-products-' + ymd + '.' + ext;
}

/** JSON出力：全商品をそのままJSONファイルにする */
function exportJson(products) {
  const json = JSON.stringify(products, null, 2);
  downloadTextFile(exportFileName('json'), json, 'application/json');
}

/** CSVの1マス用に文字列を安全にする（カンマや改行があっても壊れないように） */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

/** CSV出力：Excelでそのまま開ける形式（BOM付きUTF-8） */
function exportCsv(products) {
  const header = [
    '管理番号', '商品名', 'Taobao商品ID', '商品URL',
    '人民元価格', '通常価格(元)', '日本円販売価格',
    'カラー', 'サイズ', '画像枚数', '画像URL', '登録日時'
  ];
  const rows = [header.map(csvCell).join(',')];

  for (const p of products) {
    rows.push([
      csvCell(p.code),
      csvCell(p.title),
      csvCell(p.taobaoId),
      csvCell(p.url),
      csvCell(p.priceCny),
      csvCell(p.originalPriceCny),
      csvCell(p.priceJpy),
      csvCell((p.colors || []).join(' / ')),
      csvCell((p.sizes || []).join(' / ')),
      csvCell((p.images || []).length),
      csvCell((p.images || []).join(' | ')),
      csvCell(p.createdAt)
    ].join(','));
  }

  // 先頭の "﻿" はBOM。これが無いとExcelで文字化けします。
  downloadTextFile(exportFileName('csv'), '﻿' + rows.join('\r\n'), 'text/csv');
}
