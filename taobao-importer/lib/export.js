/**
 * export.js
 * ============================================================
 * 保存した商品データをファイルとして出力するためのファイル。
 *
 *   ① exportJson / exportCsv … 全項目入りのバックアップ用
 *   ② exportXPostCsv         … 既存X自動投稿システム用の products.csv
 *   ③ downloadProductImages  … 商品画像を MAMC-000001-01.jpg の形で保存
 *
 * ②③が「X自動投稿システムへの受け渡し」用です。
 * ダウンロードフォルダの x-post-export/ の中に
 * products.csv と images/ が作られるので、その中身を
 * 既存システムの products.csv / images フォルダにコピーして使います。
 *
 * 将来「GitHubへ自動送信」を作るときも、ここに関数を足していくイメージです。
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
    console.error('[商品取り込み] ダウンロードに失敗:', e);
    alert('ファイルのダウンロードに失敗しました: ' + e.message);
  }
}

/** 今日の日付入りのファイル名を作る（例: products-2026-09-12） */
function exportFileName(ext) {
  const d = new Date();
  const ymd = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  return 'products-' + ymd + '.' + ext;
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
    '管理番号', 'ブランド', '仕入れ先', '販売タイトル', '元タイトル',
    '商品ID', '商品URL', '元価格', '通貨', '元の定価', '販売価格(円)',
    'カラー', 'サイズ', '画像枚数', '画像URL', '登録日時'
  ];
  const rows = [header.map(csvCell).join(',')];

  for (const p of products) {
    rows.push([
      csvCell(p.code),
      csvCell(p.brand),
      csvCell(p.supplier),
      csvCell(p.title),
      csvCell(p.originalTitle),
      csvCell(p.productId || p.taobaoId),
      csvCell(p.url),
      csvCell(p.priceOriginal ?? p.priceCny),
      csvCell(p.currency),
      csvCell(p.listPriceOriginal ?? p.originalPriceCny),
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

// ============================================================
// ここから：既存X自動投稿システム用の出力
// ============================================================

/**
 * 画像のファイル名を作る（例: MAMC-000001-01.jpg）
 * @param {string} code - 管理番号
 * @param {number} index - 何枚目か（0はじまり）
 * @param {string} url - 画像URL（拡張子の判定に使う）
 */
function imageFileName(code, index, url) {
  const m = String(url || '').match(/\.(jpe?g|png|webp|gif)/i);
  const ext = m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '.jpg';
  return code + '-' + String(index + 1).padStart(2, '0') + ext;
}

/**
 * products.csv の1列分の値を作る。
 * ★ 列を増やしたいときは、ここに case を1つ足して、
 *   設定画面の「CSVの列構成」にその名前を書けばOKです。
 */
function csvFieldValue(key, p, postText) {
  switch (key) {
    case 'id':             return p.code;
    case 'brand':          return p.brand;
    case 'product_name':   return p.title;
    case 'original_title': return p.originalTitle;
    case 'price':          return p.priceJpy;                        // 日本円販売価格
    case 'original_price': return p.priceOriginal ?? p.priceCny;     // 元サイトの価格
    case 'list_price':     return p.listPriceOriginal ?? p.originalPriceCny;
    case 'currency':       return p.currency;
    case 'product_url':    return p.url;
    case 'product_id':     return p.productId || p.taobaoId;
    case 'image':          // 1枚目の画像ファイル名
      return (p.images && p.images.length > 0)
        ? imageFileName(p.code, 0, p.images[0]) : '';
    case 'images':         // 全画像ファイル名（| 区切り）
      return (p.images || []).map((u, i) => imageFileName(p.code, i, u)).join('|');
    case 'color':          return (p.colors || []).join(' / ');
    case 'size':           return (p.sizes || []).join(' / ');
    case 'post_text':      return postText;
    case 'supplier':       return p.supplier;
    case 'created_at':     return p.createdAt;
    default:
      console.warn('[商品取り込み] 不明なCSV列:', key);
      return '';
  }
}

/**
 * 既存X自動投稿システム用の products.csv を出力する。
 * 列構成は設定画面（csvColumns）で変更できます。
 * @param {Array} products - 商品の配列（登録順）
 * @param {Array} columns - 列名の配列（例: ['id','brand',...]）
 * @param {Function} postTextFor - 商品→SNS投稿文 を返す関数
 */
async function exportXPostCsv(products, columns, postTextFor) {
  const cols = (columns && columns.length > 0) ? columns : DEFAULT_CSV_COLUMNS;
  const rows = [cols.map(csvCell).join(',')];
  for (const p of products) {
    const postText = postTextFor ? postTextFor(p) : '';
    rows.push(cols.map((key) => csvCell(csvFieldValue(key, p, postText))).join(','));
  }
  // 画像と同じ x-post-export/ フォルダに入れたいので chrome.downloads を使う
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: url,
      filename: 'x-post-export/products.csv',
      conflictAction: 'overwrite'
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * 商品画像を「管理番号-連番.jpg」の名前でダウンロードする。
 * chrome.downloads を使うので、ダウンロードフォルダの
 * x-post-export/images/ の中に保存されます。
 * @param {object} product - 保存済みの商品（code, images を使う）
 * @returns {Promise<number>} 開始したダウンロード数
 */
async function downloadProductImages(product) {
  const images = product.images || [];
  let count = 0;
  for (let i = 0; i < images.length; i++) {
    const filename = 'x-post-export/images/' + imageFileName(product.code, i, images[i]);
    try {
      await chrome.downloads.download({
        url: images[i],
        filename: filename,
        conflictAction: 'overwrite'
      });
      count++;
    } catch (e) {
      console.warn('[商品取り込み] 画像のダウンロードに失敗:', images[i], e);
    }
  }
  console.log('[商品取り込み] 画像を', count, '枚ダウンロードしました:', product.code);
  return count;
}
