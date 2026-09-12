/**
 * scraper.js
 * ============================================================
 * 「この商品を取り込む」ボタンを押したときに、
 * いま表示している商品ページ 1ページ だけに注入されて実行されます。
 *
 * ・ページを移動したり、他のページを開いたりは一切しません
 * ・すでにブラウザに読み込まれているHTMLから情報を拾うだけです
 * ・どれか1項目が取れなくても止まらず、取れた分だけ返します
 *
 * セレクタ（どの要素から取るか）は selectors.js にまとめてあります。
 * ============================================================
 */

(() => {
  const S = window.MAMC_SELECTORS;
  const LOG = '[MAMC取り込み]';

  // ---------- 小さな道具たち ----------

  /** セレクタ候補を上から順に試して、最初に見つかった要素を返す */
  function findFirst(selectorList) {
    for (const sel of selectorList) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) { /* 無効なセレクタはスキップ */ }
    }
    return null;
  }

  /** セレクタ候補を上から順に試して、最初に1件以上見つかった要素の配列を返す */
  function findAll(selectorList) {
    for (const sel of selectorList) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (e) { /* 無効なセレクタはスキップ */ }
    }
    return [];
  }

  /** 要素からテキストを取り出す（前後の空白は削除） */
  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** "¥ 128.00" や "128-256" のような文字列から最初の数値を取り出す */
  function parseNumber(text) {
    if (!text) return null;
    const m = String(text).replace(/[,，]/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  // ---------- 各項目の取得 ----------

  /** 商品ID：URLの ?id=123456 から取る */
  function getTaobaoId() {
    try {
      const id = new URL(location.href).searchParams.get('id');
      if (id) return id;
      // URLに id が無いタイプ（/item/123456.htm など）にも一応対応
      const m = location.pathname.match(/(\d{8,})/);
      return m ? m[1] : '';
    } catch (e) {
      console.warn(LOG, '商品IDの取得に失敗:', e);
      return '';
    }
  }

  /** 商品名 */
  function getTitle() {
    try {
      const el = findFirst(S.title);
      let title = textOf(el);
      if (!title) {
        // 最終手段：ページタイトルから「-淘宝网」などを削って使う
        title = document.title
          .replace(/[-|_－].{0,12}(淘宝|天猫|taobao|tmall).*$/i, '')
          .trim();
      }
      return title;
    } catch (e) {
      console.warn(LOG, '商品名の取得に失敗:', e);
      return '';
    }
  }

  /** 現在価格（人民元） */
  function getPrice() {
    try {
      const el = findFirst(S.price);
      const n = parseNumber(textOf(el));
      if (n !== null) return n;

      // 予備：class名に price を含む要素を広めに探す（最大50個まで）
      const candidates = Array.from(document.querySelectorAll('[class*="rice"]')).slice(0, 50);
      for (const c of candidates) {
        const v = parseNumber(textOf(c));
        if (v !== null && v > 0 && v < 1000000) return v;
      }
      return null;
    } catch (e) {
      console.warn(LOG, '価格の取得に失敗:', e);
      return null;
    }
  }

  /** 通常価格（元値）。無いページも多いので取れなければ null */
  function getOriginalPrice() {
    try {
      const el = findFirst(S.originalPrice);
      return parseNumber(textOf(el));
    } catch (e) {
      console.warn(LOG, '通常価格の取得に失敗:', e);
      return null;
    }
  }

  /** SKU（カラー・サイズなどの属性一覧）を取る */
  function getSkuProps() {
    const props = []; // 例: [{ name: '颜色分类', values: ['白色', '黑色'] }]
    try {
      for (const g of S.skuGroups) {
        const groups = document.querySelectorAll(g.group);
        for (const groupEl of groups) {
          const name = textOf(groupEl.querySelector(g.label));
          const valueEls = groupEl.querySelectorAll(g.value);
          const values = [];
          for (const v of valueEls) {
            // img[alt] の場合は alt 属性、それ以外はテキスト
            const t = v.tagName === 'IMG' ? (v.alt || '').trim() : textOf(v);
            if (t && !values.includes(t)) values.push(t);
          }
          if (name && values.length > 0) {
            props.push({ name, values });
          }
        }
        if (props.length > 0) break; // どれかの構造で取れたらそこで終了
      }
    } catch (e) {
      console.warn(LOG, 'SKUの取得に失敗:', e);
    }
    return props;
  }

  /** SKU属性の中から「カラーらしいもの」「サイズらしいもの」を選び出す */
  function pickColorsAndSizes(skuProps) {
    const colorWords = /(颜色|色|カラー|color)/i;
    const sizeWords = /(尺码|尺寸|大小|码数|规格|サイズ|size)/i;
    let colors = [];
    let sizes = [];
    for (const p of skuProps) {
      if (colorWords.test(p.name) && colors.length === 0) colors = p.values;
      else if (sizeWords.test(p.name) && sizes.length === 0) sizes = p.values;
    }
    return { colors, sizes };
  }

  // ---------- 画像の取得 ----------

  /**
   * 画像URLを「大きいサイズの元URL」に正規化する。
   * Taobaoのサムネイルは
   *   xxxx.jpg_60x60q90.jpg_.webp
   * のように末尾へ縮小指定が付くので、最初の .jpg/.png までを取り出す。
   * これが重複削除のキーにもなります。
   */
  function normalizeImageUrl(url) {
    if (!url) return '';
    let u = url.trim();
    if (u.startsWith('//')) u = 'https:' + u;      // //img.alicdn.com/... 対策
    if (!/^https?:\/\//i.test(u)) return '';       // data:画像などは対象外
    const m = u.match(/^(.*?\.(?:jpg|jpeg|png))/i);
    return m ? m[1] : u;
  }

  /** 商品と無関係そうな画像かどうか */
  function isExcludedImage(url) {
    return S.excludeImagePatterns.some((re) => re.test(url));
  }

  /** img要素から実際のURLを取り出す（遅延読み込み属性にも対応） */
  function urlFromImg(img) {
    return (
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-ks-lazyload') ||
      img.getAttribute('data-lazyload') ||
      ''
    );
  }

  /**
   * ページ内から商品画像を集める。
   * kind: 'main'（ギャラリー） / 'detail'（説明エリア） / 'other'
   */
  function getImages() {
    const seen = new Set();       // 重複削除用（正規化URLがキー）
    const images = [];            // [{ url, kind }]

    function add(rawUrl, kind, imgEl) {
      try {
        const url = normalizeImageUrl(rawUrl);
        if (!url) return;
        if (seen.has(url)) return;                    // 重複は捨てる
        if (isExcludedImage(url)) return;             // 無関係そうな画像は捨てる

        // 小さすぎる画像（アイコン等）を除外。
        // ただし遅延読み込みでサイズ不明(0)のものは、商品画像CDNなら通す。
        const w = imgEl ? (imgEl.naturalWidth || imgEl.width || 0) : 0;
        const h = imgEl ? (imgEl.naturalHeight || imgEl.height || 0) : 0;
        const looksLikeProduct = S.productImagePatterns.some((re) => re.test(url));
        if (w > 0 && h > 0 && (w < S.minImageSize || h < S.minImageSize) && kind !== 'main') {
          return;
        }
        if (w === 0 && h === 0 && !looksLikeProduct && kind === 'other') {
          return;
        }

        seen.add(url);
        images.push({ url, kind });
      } catch (e) { /* 1枚の失敗で全体は止めない */ }
    }

    try {
      // ① ギャラリー（メイン画像＋サムネイル）
      const mainEl = findFirst(S.mainImage);
      if (mainEl) add(urlFromImg(mainEl), 'main', mainEl);
      for (const img of findAll(S.thumbImages)) add(urlFromImg(img), 'main', img);

      // ② 商品説明エリアの画像
      const detailEl = findFirst(S.detailArea);
      if (detailEl) {
        for (const img of detailEl.querySelectorAll('img')) {
          add(urlFromImg(img), 'detail', img);
        }
      }

      // ③ 念のためページ全体の alicdn 画像も拾う（上の①②と重複すれば自動で捨てられる）
      for (const img of document.querySelectorAll('img')) {
        const raw = urlFromImg(img);
        if (raw && S.productImagePatterns.some((re) => re.test(raw))) {
          add(raw, 'other', img);
        }
      }
    } catch (e) {
      console.warn(LOG, '画像の取得中にエラー:', e);
    }

    return images.slice(0, 80); // 念のため最大80枚まで
  }

  // ---------- ここから実行 ----------

  console.log(LOG, '取り込みを開始します:', location.href);

  const skuProps = getSkuProps();
  const { colors, sizes } = pickColorsAndSizes(skuProps);

  const result = {
    ok: true,
    scrapedAt: new Date().toISOString(),
    url: location.href,
    taobaoId: getTaobaoId(),
    title: getTitle(),
    priceCny: getPrice(),          // 取れなければ null（確認画面で手入力できます）
    originalPriceCny: getOriginalPrice(),
    colors,                        // 例: ['白色', '黑色']
    sizes,                         // 例: ['S', 'M', 'L']
    skuProps,                      // カラー/サイズ以外も含む生データ
    images: getImages()            // [{ url, kind }]
  };

  console.log(LOG, '取り込み結果:', result);
  return result;
})();
