/**
 * price.js
 * ============================================================
 * 日本円の販売価格を計算するファイル。
 *
 * ★ 計算式を変えたいときは calculateSellingPrice() の中身だけ
 *   書き換えれば OK です。他のファイルは触らなくて大丈夫。
 *
 * 為替レート・送料・利益率・丸め単位は設定画面から変更できます
 * （settings に入って渡ってきます）。
 * ============================================================
 */

/**
 * 人民元価格 → 日本円販売価格 を計算する
 * @param {number} priceCny - 人民元の価格（例: 128.5）
 * @param {object} settings - 設定値（exchangeRate, shippingJpy, profitRate, roundUnit）
 * @returns {number|null} 日本円の販売価格。計算できないときは null
 */
function calculateSellingPrice(priceCny, settings) {
  if (priceCny === null || priceCny === undefined || isNaN(priceCny) || priceCny <= 0) {
    return null;
  }
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});

  // ① 円換算：人民元 × 為替レート
  const jpy = priceCny * s.exchangeRate;

  // ② 送料を加算
  const withShipping = jpy + s.shippingJpy;

  // ③ 利益を加算（利益率 %）
  const withProfit = withShipping * (1 + s.profitRate / 100);

  // ④ キリのいい数字に切り上げ（例: 100円単位）
  const unit = s.roundUnit > 0 ? s.roundUnit : 1;
  return Math.ceil(withProfit / unit) * unit;
}

/** 12345 → "¥12,345" のような表示用文字列にする */
function formatJpy(value) {
  if (value === null || value === undefined || isNaN(value)) return '';
  return '¥' + Number(value).toLocaleString('ja-JP');
}
