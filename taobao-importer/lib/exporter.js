/**
 * exporter.js
 * ============================================================
 * 保存した商品データを JSON / CSV ファイルとして出力します。
 *
 * 将来 Googleスプレッドシートや BUYMA 連携を作るときは、
 * ここに「productsToXxx()」形式の関数を追加していけば OK です。
 * ============================================================
 */

'use strict';

/** 商品一覧 → JSON文字列 */
function productsToJson(products) {
  return JSON.stringify(products, null, 2);
}

/** CSVの1マス用に文字列を安全にする(カンマ・改行・引用符対応) */
function csvEscape(value) {
  var text = (value === null || value === undefined) ? '' : String(value);
  if (/[",\r\n]/.test(text)) {
    text = '"' + text.split('"').join('""') + '"';
  }
  return text;
}

/** 商品一覧 → CSV文字列(Excelで開けるようBOM付き) */
function productsToCsv(products) {
  var header = [
    '管理番号', '商品名', 'Taobao商品ID', '商品URL',
    '現在価格(元)', '通常価格(元)', '販売価格(円)',
    'カラー', 'サイズ', 'SKU情報',
    'メイン画像', '画像URL一覧', '登録日時', 'SNS投稿文'
  ];
  var lines = [header.join(',')];

  (products || []).forEach(function (p) {
    lines.push([
      csvEscape(p.managementNumber),
      csvEscape(p.title),
      csvEscape(p.taobaoItemId),
      csvEscape(p.url),
      csvEscape(p.priceCny),
      csvEscape(p.originalPriceCny),
      csvEscape(p.priceJpy),
      csvEscape((p.colors || []).join('、')),
      csvEscape((p.sizes || []).join('、')),
      csvEscape(p.skuText),
      csvEscape(p.mainImage),
      csvEscape((p.images || []).join(' | ')),
      csvEscape(p.createdAt),
      csvEscape(p.snsText)
    ].join(','));
  });

  // 先頭の「﻿」はBOM。ExcelでCSVの日本語が文字化けしないようにするおまじない
  return '﻿' + lines.join('\r\n');
}

/** テキストをファイルとしてダウンロードさせる */
function downloadTextFile(filename, text, mimeType) {
  var blob = new Blob([text], { type: mimeType || 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 少し待ってからURLを片付ける
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}

/** ファイル名用の日時(例: 20260912-1530) */
function timestampForFilename() {
  var d = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}
