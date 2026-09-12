/**
 * sns.js
 * ============================================================
 * SNS投稿用の文章を作るファイル。
 * 文章のテンプレート自体は設定画面から変更できます
 * （初期値は lib/config.js の DEFAULT_SNS_TEMPLATE）。
 * ============================================================
 */

/**
 * 商品データとテンプレートから SNS 投稿文を作る
 * @param {object} product - 保存済みの商品（code, title, priceJpy など）
 * @param {string} template - テンプレート文字列（{{code}} などを含む）
 * @returns {string} 完成した投稿文
 */
function buildSnsText(product, template) {
  const t = template || DEFAULT_SNS_TEMPLATE;

  // 置き換え用のデータを用意（無い項目は「-」にする）
  const values = {
    code: product.code || '-',
    title: product.title || '-',
    priceJpy: formatJpy(product.priceJpy) || '-',
    priceCny: (product.priceCny !== null && product.priceCny !== undefined)
      ? product.priceCny + '元' : '-',
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
