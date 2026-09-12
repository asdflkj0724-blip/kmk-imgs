/**
 * price.js
 * ============================================================
 * 販売価格を計算するファイル。
 *
 * 計算のもとになる「価格ルール」はブランドごとに設定画面から
 * 変更できます（換算レート／＋円／−円／×倍／＋％／丸め単位）。
 *
 * ★ ルールの種類自体を増やしたいときは、applyPriceStep() に
 *   新しい op を1つ足すだけでOKです。
 * ============================================================
 */

/** 計算ステップを1つ適用する */
function applyPriceStep(value, step) {
  const n = Number(step.value) || 0;
  switch (step.op) {
    case 'add':      return value + n;               // ＋n円
    case 'subtract': return value - n;               // −n円
    case 'multiply': return value * n;               // ×n倍
    case 'percent':  return value * (1 + n / 100);   // ＋n％
    default:
      console.warn('[商品取り込み] 不明な計算ステップ:', step.op);
      return value;
  }
}

/**
 * 元価格 → 販売価格（円）を計算する
 * @param {number} originalPrice - 元サイトの価格
 * @param {object} priceRule - ブランドの価格ルール（exchangeRate, steps, roundUnit）
 * @returns {number|null} 販売価格（円）。計算できないときは null
 */
function calculateSellingPrice(originalPrice, priceRule) {
  const p = Number(originalPrice);
  if (isNaN(p) || p <= 0) return null;
  const rule = priceRule || DEFAULT_PRICE_RULE;

  // ① 換算（外貨のサイト用。日本円のサイトはレート1のまま）
  let value = p * (Number(rule.exchangeRate) || 1);

  // ② 設定されたステップを上から順に適用
  for (const step of rule.steps || []) {
    value = applyPriceStep(value, step);
  }
  if (value < 0) value = 0;

  // ③ キリのいい数字に切り上げ
  const unit = Number(rule.roundUnit) > 0 ? Number(rule.roundUnit) : 1;
  return Math.ceil(value / unit) * unit;
}

/** ルールの内容を「×22 → ＋2000円 → ＋30% → 100円単位切上げ」の形で説明する */
function describePriceRule(rule) {
  if (!rule) return '';
  const parts = [];
  if (Number(rule.exchangeRate) !== 1) parts.push('×' + rule.exchangeRate + '（換算）');
  for (const step of rule.steps || []) {
    if (step.op === 'add') parts.push('＋' + step.value + '円');
    else if (step.op === 'subtract') parts.push('−' + step.value + '円');
    else if (step.op === 'multiply') parts.push('×' + step.value + '倍');
    else if (step.op === 'percent') parts.push('＋' + step.value + '%');
  }
  parts.push(rule.roundUnit + '円単位切上げ');
  return parts.join(' → ');
}

/** 12345 → "¥12,345" のような表示用文字列にする */
function formatJpy(value) {
  if (value === null || value === undefined || isNaN(value)) return '';
  return '¥' + Number(value).toLocaleString('ja-JP');
}
