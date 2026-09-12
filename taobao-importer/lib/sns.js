/**
 * sns.js
 * ============================================================
 * SNS投稿用の文章を作るファイルです。
 *
 * 文章テンプレートは「設定画面」からいつでも変更できます。
 * テンプレートの中では次の置き換えワードが使えます:
 *
 *   {商品番号}  → MAMC-000001 などの管理番号
 *   {販売価格}  → ¥12,300 などの日本円販売価格
 *   {カラー}    → カラー展開(カンマ区切り)
 *   {サイズ}    → サイズ展開(カンマ区切り)
 *   {商品名}    → 商品名
 * ============================================================
 */

'use strict';

/** SNS投稿文の初期テンプレート(設定画面で変更可能) */
var DEFAULT_SNS_TEMPLATE = [
  'MAMC 新着商品✨',
  '',
  '商品番号:{商品番号}',
  '価格:{販売価格}',
  '',
  'カラー:{カラー}',
  'サイズ:{サイズ}',
  '',
  '気になる方は商品番号「{商品番号}」を送ってください。',
  '在庫・サイズを確認します。',
  '',
  '詳細画像をご希望の場合も商品番号を送ってください。'
].join('\n');

/**
 * 商品データからSNS投稿文を作る
 * @param {object} product  保存する商品データ
 * @param {string} template テンプレート(省略時は初期テンプレート)
 * @returns {string} SNS投稿文
 */
function generateSnsText(product, template) {
  var t = template || DEFAULT_SNS_TEMPLATE;
  var colors = (product.colors && product.colors.length > 0)
    ? product.colors.join('、') : '-';
  var sizes = (product.sizes && product.sizes.length > 0)
    ? product.sizes.join('、') : '-';
  var priceText = (product.priceJpy !== null && product.priceJpy !== undefined)
    ? formatJpy(product.priceJpy) : '-';

  return t
    .split('{商品番号}').join(product.managementNumber || '-')
    .split('{販売価格}').join(priceText)
    .split('{カラー}').join(colors)
    .split('{サイズ}').join(sizes)
    .split('{商品名}').join(product.title || '-');
}
