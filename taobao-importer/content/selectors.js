/**
 * selectors.js
 * ============================================================
 * サイトごとの「読み取りプロフィール」を集めたファイル。
 *
 * この拡張は基本的にどのサイトでも動く汎用の読み取り
 * （scraper.js 内の JSON-LD / OGP / 一般的なセレクタ）を持っていて、
 * ここに登録したサイトだけ、より正確な専用セレクタで上書きします。
 *
 * ★ あるサイトでうまく取れないときは、このファイルに
 *   そのサイト用のプロフィールを1つ追加すればOKです。
 *   （scraper.js は触らなくて大丈夫）
 *
 * プロフィールの書き方：
 *   id       … 好きな名前
 *   match    … どのサイトで使うか（URLのホスト名にマッチする正規表現）
 *   currency … そのサイトの通貨（'CNY' 'JPY' 'USD' など）
 *   selectors.title / price / originalPrice / mainImage / thumbImages / detailArea
 *            … 候補セレクタの配列（上から順に試す）
 *   skuGroups … カラー・サイズなどの属性ブロックの探し方
 *   imageUrlCut … 画像URLをこの正規表現で切り出して大きい元画像にする（任意）
 * ============================================================
 */

window.SITE_PROFILES = [

  // ---------- Taobao / Tmall ----------
  {
    id: 'taobao',
    match: /(taobao|tmall)\.com$/i,
    currency: 'CNY',
    selectors: {
      title: [
        'h1[class*="ItemTitle"]',
        'h1[class*="ItemHeader"]',
        '[class*="mainTitle"]',
        '.tb-main-title',
        '.tb-detail-hd h1'
      ],
      price: [
        '[class*="Price--priceText"]',
        '[class*="priceText"]',
        '[class*="salePrice"] [class*="text"]',
        '#J_PromoPriceNum',
        '.tm-promo-price .tm-price',
        '.tb-rmb-num',
        '.tm-price'
      ],
      originalPrice: [
        '[class*="Price--originPrice"]',
        '[class*="originPrice"]',
        '[class*="linePrice"]',
        '#J_StrPriceModBox .tb-rmb-num',
        '.tm-price-cur .tm-price'
      ],
      mainImage: [
        '[class*="PicGallery"] img[class*="mainPic"]',
        '[class*="mainPic"] img',
        '[class*="MainPic"] img',
        '#J_ImgBooth'
      ],
      thumbImages: [
        '[class*="thumbnails"] img',
        'ul[class*="thumb"] img',
        '[class*="PicGallery"] img',
        '#J_UlThumb img',
        'ul#J_TabBarUl img'
      ],
      detailArea: [
        '[class*="descV8"]',
        '#description',
        '.detail-content',
        '#J_DivItemDesc',
        '[class*="DetailDesc"]'
      ]
    },
    skuGroups: [
      { // 新PC版
        group: '[class*="SkuContent"] [class*="skuItem"]',
        label: '[class*="ItemLabel"], [class*="labelText"], [class*="skuLabel"]',
        value: '[class*="valueItemText"], [class*="skuValueName"], [class*="valueItem"] img[alt]'
      },
      { // 旧版
        group: '.tb-sku .tb-prop, .tb-sku dl',
        label: 'dt',
        value: 'dd li span, dd li a'
      }
    ],
    // Taobaoのサムネイルは「xxx.jpg_60x60q90.jpg_.webp」形式なので
    // 最初の .jpg までを切り出すと大きい元画像になる
    imageUrlCut: /^(.*?\.(?:jpg|jpeg|png))/i,
    productImagePatterns: [
      /img\.alicdn\.com\/imgextra\//i,
      /img\.alicdn\.com\/bao\/uploaded\//i
    ],
    extraExcludePatterns: [
      /\/tps\//i,
      /\bg\.alicdn\.com/i,
      /\bgw\.alicdn\.com\/tfs/i,
      /rate\.taobao/i,
      /spaceball/i
    ]
  }

  // ---------- 新しいサイトはここに追加 ----------
  // 例：
  // {
  //   id: 'example',
  //   match: /example\.com$/i,
  //   currency: 'JPY',
  //   selectors: {
  //     title: ['h1.product-name'],
  //     price: ['.product-price'],
  //     originalPrice: [],
  //     mainImage: ['.main-photo img'],
  //     thumbImages: ['.thumbnails img'],
  //     detailArea: ['.product-description']
  //   },
  //   skuGroups: []
  // }
];

// ============================================================
// どのサイトでも共通で使う設定
// ============================================================
window.SCRAPER_COMMON = {

  // 汎用のセレクタ（プロフィールが無いサイトで使う）
  generic: {
    title: [
      'h1[itemprop="name"]',
      '[itemprop="name"]',
      'h1.product-title, h1.product-name, h1.item-name',
      'h1'
    ],
    price: [
      '[itemprop="price"]',
      '.product-price, .item-price, .price-value',
      '[class*="ProductPrice"], [class*="productPrice"]',
      '.price'
    ],
    originalPrice: [
      '[class*="original-price"], [class*="originalPrice"]',
      '[class*="regular-price"], [class*="regularPrice"]',
      '.price del, del .price, s .price, .price s'
    ],
    mainImage: [
      '[itemprop="image"]',
      '.product-image img, .main-image img, [class*="MainImage"] img'
    ],
    thumbImages: [
      '.thumbnails img, [class*="thumbnail"] img, [class*="Thumb"] img'
    ],
    detailArea: [
      '[itemprop="description"]',
      '.product-description, .item-description, #description',
      '[class*="ProductDescription"], [class*="product-detail"]'
    ]
  },

  // カラー・サイズを見分けるためのキーワード
  colorWords: /(color|colour|カラー|色|颜色)/i,
  sizeWords: /(size|サイズ|尺码|尺寸|寸法|大小|码数)/i,
  // 選択肢の中で「未選択」を意味する言葉（無視する）
  placeholderWords: /^(選択|選択して|please select|select|choose|--|——)/i,

  // 商品と無関係な画像をURLで見分けて除外するルール
  excludeImagePatterns: [
    /\.gif($|\?)/i,
    /\.svg($|\?)/i,
    /avatar/i,
    /\blogo\b/i,
    /\bicon/i,
    /sprite/i,
    /\bbanner/i,
    /favicon/i,
    /video/i,
    /\bbtn\b|button/i
  ],

  // これより小さい画像はアイコン等とみなして除外（px）
  minImageSize: 180,

  // 取り込む画像の最大枚数
  maxImages: 80
};
