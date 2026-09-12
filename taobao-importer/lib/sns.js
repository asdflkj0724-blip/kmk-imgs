/**
 * sns.js
 * ============================================================
 * SNS投稿用の文章を作るファイル。
 * 文章のテンプレートは設定画面から変更できます
 * （初期値は lib/config.js の DEFAULT_SNS_TEMPLATE）。
 * ============================================================
 */

/**
 * 商品データとテンプレートから SNS 投稿文を作る
 * @param {object} product - 保存済みの商品（code, brand, title, priceJpy など）
 * @param {string} template - テンプレート文字列（{{code}} などを含む）
 * @returns {string} 完成した投稿文
 */
function buildSnsText(product, template) {
  const t = template || DEFAULT_SNS_TEMPLATE;

  // 元価格の表示（例: "128 CNY" / "5900 JPY"）
  let priceOriginal = '-';
  if (product.priceOriginal !== null && product.priceOriginal !== undefined) {
    priceOriginal = product.priceOriginal + (product.currency ? ' ' + product.currency : '');
  }

  // 置き換え用のデータを用意（無い項目は「-」にする）
  const values = {
    code: product.code || '-',
    brand: product.brand || '-',
    title: product.title || '-',
    originalTitle: product.originalTitle || '-',
    priceJpy: formatJpy(product.priceJpy) || '-',
    priceOriginal: priceOriginal,
    colors: (product.colors && product.colors.length > 0)
      ? product.colors.join(' / ') : '-',
    sizes: (product.sizes && product.sizes.length > 0)
      ? product.sizes.join(' / ') : '-',
    url: product.url || '-'
  };

  // {{key}} を実際の値に置き換える
  return t.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in values ? values[key] : match;
  });
}
