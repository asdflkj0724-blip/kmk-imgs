/**
 * price.js
 * ============================================================
 * 日本円の販売価格を計算するファイルです。
 *
 * ★ 販売価格の計算式を変えたいときは calculateSellingPrice() の
 *   中身だけを書き換えれば OK です(他のファイルは触らなくて良い)。
 *
 * 為替レート・送料・利益などの数値は「設定画面」から変更でき、
 * chrome.storage に保存されます(初期値は下の DEFAULT_PRICE_SETTINGS)。
 * ============================================================
 */

'use strict';

/** 価格計算の初期設定(設定画面で変更可能) */
var DEFAULT_PRICE_SETTINGS = {
  exchangeRate: 22.0,  // 為替レート: 1元 = 何円か(仮の値)
  shippingJpy: 1500,   // 送料(円)
  profitJpy: 3000,     // 利益(円)
  roundUnit: 100       // 端数処理: 何円単位で切り上げるか(1なら処理なし)
};

/**
 * 販売価格(日本円)を計算する
 *
 * @param {number} priceCny  人民元の価格(例: 128.5)
 * @param {object} settings  価格設定(exchangeRate / shippingJpy / profitJpy / roundUnit)
 * @returns {number|null}    販売価格(円)。計算できないときは null
 *
 * いまの計算式:
 *   人民元価格
 *     ↓ 為替レートを掛けて円換算
 *     ↓ 送料を加算
 *     ↓ 利益を加算
 *     ↓ roundUnit 単位で切り上げ
 *   販売価格
 */
function calculateSellingPrice(priceCny, settings) {
  var s = Object.assign({}, DEFAULT_PRICE_SETTINGS, settings || {});

  var price = Number(priceCny);
  if (!isFinite(price) || price <= 0) return null;

  // ---- ここから計算式(自由に書き換えてOK) ----
  var yen = price * s.exchangeRate;      // 1. 円換算
  yen = yen + Number(s.shippingJpy);     // 2. 送料を加算
  yen = yen + Number(s.profitJpy);       // 3. 利益を加算

  var unit = Number(s.roundUnit) || 1;   // 4. 端数を切り上げ
  yen = Math.ceil(yen / unit) * unit;
  // ---- ここまで計算式 ----

  return yen;
}

/**
 * 計算の内訳を文字列で返す(確認画面の表示用)
 * 例: 「128元 × 22円 = 2,816円 + 送料1,500円 + 利益3,000円 → 7,400円」
 */
function describeSellingPrice(priceCny, settings) {
  var s = Object.assign({}, DEFAULT_PRICE_SETTINGS, settings || {});
  var price = Number(priceCny);
  if (!isFinite(price) || price <= 0) return '';
  var yen = price * s.exchangeRate;
  return price + '元 × ' + s.exchangeRate + '円 = ' + formatJpy(yen) +
    ' + 送料' + formatJpy(s.shippingJpy) +
    ' + 利益' + formatJpy(s.profitJpy) +
    '(' + s.roundUnit + '円単位で切り上げ)';
}

/** 12345 → 「¥12,345」の形にする */
function formatJpy(n) {
  if (n === null || n === undefined || !isFinite(Number(n))) return '-';
  return '¥' + Math.round(Number(n)).toLocaleString('ja-JP');
}
