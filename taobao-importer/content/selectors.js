/**
 * selectors.js
 * ============================================================
 * Taobao ページから情報を取り出すための「セレクタ」を
 * すべてこのファイルに集約しています。
 *
 * ★ Taobao の HTML 構造が変わって取得できなくなったときは、
 *   基本的にこのファイルだけを修正すれば OK です。
 *
 * 各項目は「候補セレクタの配列」になっていて、
 * 上から順に試して、最初に見つかったものを使います。
 * (Taobao は時期・ページ種類によってクラス名が変わるため)
 * ============================================================
 */

// 再注入(ボタンを2回押すなど)でもエラーにならないよう window に入れる
window.TAOBAO_SELECTORS = {

  // ---------- 商品名 ----------
  title: [
    'h1[class*="ItemTitle"]',          // 新しいTaobao PCページ
    '[class*="ItemHeader"] h1',
    '[class*="mainTitle"]',
    '#J_Title h3',                     // 旧Taobao
    '.tb-detail-hd h1',                // 旧Tmall
    'h1'
  ],

  // ---------- 現在価格(人民元) ----------
  currentPrice: [
    '[class*="Price--priceText"]',     // 新しいTaobao
    '[class*="priceText"]',
    '[class*="salePrice"]',
    '#J_PromoPriceNum',                // 旧Taobao セール価格
    '#J_StrPrice .tb-rmb-num',         // 旧Taobao 通常表示
    '.tm-promo-price .tm-price',       // 旧Tmall
    '.tm-price'
  ],

  // ---------- 通常価格(セール前の価格・取り消し線price) ----------
  originalPrice: [
    '[class*="Price--linePriceText"]',
    '[class*="linePrice"]',
    '[class*="originPrice"]',
    '#J_StrPriceModBox .tb-rmb-num',
    '.tm-price-cur ~ .tm-price-original .tm-price'
  ],

  // ---------- メイン画像・ギャラリー(サムネイル一覧) ----------
  galleryImages: [
    '[class*="PicGallery"] img',
    '[class*="thumbnail"] img',
    '[class*="Thumbnail"] img',
    'ul#J_UlThumb img',                // 旧Taobao
    '#J_ImgBooth'                      // 旧Taobao メイン画像
  ],

  // ---------- 商品説明エリア内の画像 ----------
  descriptionImages: [
    '[class*="descV8"] img',
    '[class*="desc-root"] img',
    '#description img',
    '#J_DivItemDesc img'
  ],

  // ---------- SKU(カラー・サイズなどの選択肢)----------
  // skuGroups   : 「颜色分类」「尺码」などの1グループ全体
  // skuGroupLabel: グループの見出し(颜色分类 など)
  // skuValues   : 選択肢1つ1つ
  skuGroups: [
    '[class*="skuItem"]',
    '[class*="SkuItem"]',
    'dl.tb-prop',                      // 旧Taobao
    '.tm-sku-prop'                     // 旧Tmall
  ],
  skuGroupLabel: [
    '[class*="ItemLabel"]',
    '[class*="labelText"]',
    '[class*="label"]',
    'dt'
  ],
  skuValues: [
    '[class*="valueItemText"]',
    '[class*="valueItem"]',
    'dd li a span',                    // 旧Taobao
    'dd li a',
    'li a span'
  ],

  // ---------- SKU見出しの分類キーワード ----------
  // 見出しにこの文字が含まれていたら「カラー」「サイズ」として扱う
  colorLabelKeywords: ['颜色', '顏色', '色', 'カラー', 'color', 'Color'],
  sizeLabelKeywords: ['尺码', '尺碼', '尺寸', '大小', '码数', 'サイズ', 'size', 'Size'],

  // ---------- 画像の取捨選択ルール ----------
  imageFilter: {
    // このホスト名を含む画像だけを商品画像の候補にする
    includeHosts: ['alicdn.com'],
    // URLにこの文字が含まれる画像は除外する(アイコン・UI・アバター等)
    excludeKeywords: [
      'avatar', 'icon', 'logo', 'sprite', 'portrait',
      'head', 'rate', 'video', 'play', 'shop_sign',
      '.gif', 'tb_focus', 'bang/imgextra'
    ],
    // 縦横どちらかがこのpx未満と分かった画像は除外(小さなUI画像対策)
    minEdge: 150,
    // 取得する画像の最大枚数(多すぎ防止)
    maxImages: 60
  },

  // 商品ページかどうかのURL判定(ホスト名にこれらを含むこと)
  productHostKeywords: ['taobao.com', 'tmall.com']
};
