/**
 * selectors.js
 * ============================================================
 * Taobao / Tmall のページからデータを探すための「セレクタ集」。
 *
 * ★ TaobaoのHTML構造が変わって取得できなくなったときは、
 *   基本的に「このファイルだけ」を直せばOKです。
 *
 * 各項目は配列になっていて、上から順に試します。
 * （新しいデザイン → 古いデザイン の順に並べています）
 *
 * 使い方のヒント：
 *   1. Taobaoの商品ページで F12 (開発者ツール) を開く
 *   2. 取れなくなった要素を右クリック →「検証」
 *   3. その要素のクラス名を確認して、下の配列の先頭に追加する
 * ============================================================
 */

// 再注入されてもエラーにならないよう window に直接代入します
window.MAMC_SELECTORS = {

  // ---- 商品名 ----
  title: [
    'h1[class*="ItemTitle"]',        // 新PC版 Taobao
    'h1[class*="ItemHeader"]',
    '[class*="mainTitle"]',
    '.tb-main-title',                // 旧 Taobao
    '.tb-detail-hd h1',              // 旧 Tmall
    'h1'
  ],

  // ---- 現在価格（販売価格） ----
  price: [
    '[class*="Price--priceText"]',   // 新PC版
    '[class*="priceText"]',
    '[class*="salePrice"] [class*="text"]',
    '#J_PromoPriceNum',              // 旧 Taobao（セール価格）
    '.tm-promo-price .tm-price',     // 旧 Tmall（セール価格）
    '.tb-rmb-num',                   // 旧 Taobao（通常表示）
    '.tm-price'
  ],

  // ---- 通常価格（打ち消し線などの元値） ----
  originalPrice: [
    '[class*="Price--originPrice"]',
    '[class*="originPrice"]',
    '[class*="linePrice"]',
    '#J_StrPriceModBox .tb-rmb-num', // 旧 Taobao
    '.tm-price-cur .tm-price'
  ],

  // ---- メイン画像（大きく表示されている画像） ----
  mainImage: [
    '[class*="PicGallery"] img[class*="mainPic"]',
    '[class*="mainPic"] img',
    '[class*="MainPic"] img',
    '#J_ImgBooth',                   // 旧 Taobao / Tmall
    '[class*="gallery"] img'
  ],

  // ---- ギャラリーのサムネイル画像一覧 ----
  thumbImages: [
    '[class*="thumbnails"] img',
    'ul[class*="thumb"] img',
    '[class*="PicGallery"] img',
    '#J_UlThumb img',                // 旧 Taobao
    'ul#J_TabBarUl img'
  ],

  // ---- SKU（カラー・サイズなど）のまとまり ----
  // group: 1つの属性（例:「颜色分类」ブロック）を指す要素
  // label: そのブロック内の属性名（颜色分类 / 尺码 など）
  // value: そのブロック内の選択肢
  skuGroups: [
    { // 新PC版 Taobao / Tmall
      group: '[class*="SkuContent"] [class*="skuItem"]',
      label: '[class*="ItemLabel"], [class*="labelText"], [class*="skuLabel"]',
      value: '[class*="valueItemText"], [class*="skuValueName"], [class*="valueItem"] img[alt]'
    },
    { // 旧 Taobao / Tmall
      group: '.tb-sku .tb-prop, .tb-sku dl',
      label: 'dt',
      value: 'dd li span, dd li a'
    }
  ],

  // ---- 商品説明エリア（ページ下部の詳細画像が入っている場所） ----
  detailArea: [
    '[class*="descV8"]',
    '#description',
    '.detail-content',
    '#J_DivItemDesc',
    '[class*="DetailDesc"]',
    '[class*="detail-desc"]'
  ],

  // ============================================================
  // 画像の除外ルール
  // URLがこのパターンに当てはまる画像は「商品と無関係」とみなして除外します。
  // （ロゴ・アイコン・アバター・UI部品・レビュー画像など）
  // ============================================================
  excludeImagePatterns: [
    /\.gif($|\?)/i,          // GIF（ローディング等が多い）
    /\/tps\//i,              // Taobao の UI 素材置き場
    /\bg\.alicdn\.com/i,     // UI・スクリプト用CDN
    /\bgw\.alicdn\.com\/tfs/i, // バナー類
    /avatar/i,               // アバター
    /\blogo\b/i,             // ロゴ
    /\bicon/i,               // アイコン
    /rate\.taobao/i,         // レビュー関連
    /video/i,                // 動画サムネイル
    /spaceball/i,            // 透明ダミー画像
    /\.png\?getAvatar/i
  ],

  // 商品画像としてよく使われるURLのパターン（当てはまると優先的に採用）
  productImagePatterns: [
    /img\.alicdn\.com\/imgextra\//i,
    /img\.alicdn\.com\/bao\/uploaded\//i
  ],

  // これより小さい画像はアイコン等とみなして除外（px）
  minImageSize: 180
};
