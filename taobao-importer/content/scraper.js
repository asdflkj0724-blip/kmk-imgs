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
 * どのサイトでも動くように、次の順番で情報を探します：
 *   ① サイト専用プロフィール（selectors.js に登録したサイトのみ）
 *   ② JSON-LD（多くの通販サイトが埋め込んでいる商品データ）
 *   ③ OGPメタタグ（og:title, og:image など）
 *   ④ 一般的なセレクタ（h1 や .price など）
 * ============================================================
 */

(() => {
  const COMMON = window.SCRAPER_COMMON;
  const LOG = '[商品取り込み]';

  // このサイト用のプロフィールがあれば使う（無ければ null = 汎用のみ）
  const profile = (window.SITE_PROFILES || []).find(
    (p) => p.match.test(location.hostname)
  ) || null;
  console.log(LOG, 'サイト:', location.hostname,
    profile ? '（専用プロフィール: ' + profile.id + '）' : '（汎用モード）');

  // ---------- 小さな道具たち ----------

  function findFirst(selectorList) {
    for (const sel of selectorList || []) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) { /* 無効なセレクタはスキップ */ }
    }
    return null;
  }

  function findAll(selectorList) {
    for (const sel of selectorList || []) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (e) { /* 無効なセレクタはスキップ */ }
    }
    return [];
  }

  function textOf(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** "¥ 128.00" や "1,280円" のような文字列から最初の数値を取り出す */
  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const m = String(text).replace(/[,，]/g, '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  /** プロフィールのセレクタ → 汎用セレクタ の順で結合したリストを返す */
  function selectorsFor(key) {
    const fromProfile = profile && profile.selectors ? profile.selectors[key] : [];
    return (fromProfile || []).concat(COMMON.generic[key] || []);
  }

  // ---------- ② JSON-LD（schema.org の商品データ）を読む ----------

  function readJsonLd() {
    const found = { title: null, price: null, originalPrice: null, currency: null, images: [] };

    function collect(node) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(collect); return; }
      if (typeof node !== 'object') return;
      if (node['@graph']) collect(node['@graph']);

      const type = String(node['@type'] || '');
      if (/Product/i.test(type)) {
        if (!found.title && node.name) found.title = String(node.name).trim();

        // 画像は 文字列 / 配列 / {url:...} のどれかで入っている
        let imgs = node.image || [];
        if (!Array.isArray(imgs)) imgs = [imgs];
        for (const im of imgs) {
          const u = typeof im === 'string' ? im : (im && im.url);
          if (u) found.images.push(String(u));
        }

        let offers = node.offers || [];
        if (!Array.isArray(offers)) offers = [offers];
        for (const o of offers) {
          if (!o || typeof o !== 'object') continue;
          if (found.price === null) {
            found.price = parseNumber(o.price ?? o.lowPrice);
          }
          if (!found.currency && o.priceCurrency) {
            found.currency = String(o.priceCurrency);
          }
        }
      }
    }

    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          collect(JSON.parse(s.textContent));
        } catch (e) { /* 壊れたJSONはスキップ */ }
      }
    } catch (e) {
      console.warn(LOG, 'JSON-LDの読み取りに失敗:', e);
    }
    return found;
  }

  // ---------- ③ OGPメタタグを読む ----------

  function readMeta(nameList) {
    for (const name of nameList) {
      const el = document.querySelector(
        'meta[property="' + name + '"], meta[name="' + name + '"]'
      );
      if (el && el.content) return el.content.trim();
    }
    return '';
  }

  function readMetaAll(name) {
    return Array.from(
      document.querySelectorAll('meta[property="' + name + '"], meta[name="' + name + '"]')
    ).map((el) => el.content).filter(Boolean);
  }

  // ---------- 各項目の取得 ----------

  /** 商品ID：URLのid系パラメータ、無ければパス内の長い数字 */
  function getProductId() {
    try {
      const u = new URL(location.href);
      for (const key of ['id', 'itemid', 'item_id', 'pid', 'product_id', 'goodsid', 'sku']) {
        const v = u.searchParams.get(key);
        if (v) return v;
      }
      const m = u.pathname.match(/(\d{6,})/);
      return m ? m[1] : '';
    } catch (e) {
      console.warn(LOG, '商品IDの取得に失敗:', e);
      return '';
    }
  }

  function getTitle(jsonLd) {
    try {
      // ① サイト専用 or 汎用セレクタ
      const el = findFirst(selectorsFor('title'));
      let title = textOf(el);
      // ② JSON-LD → ③ OGP → ④ ページタイトル
      if (!title) title = jsonLd.title || '';
      if (!title) title = readMeta(['og:title', 'twitter:title']);
      if (!title) {
        title = document.title
          .replace(/[-|｜_－].{0,20}$/, '') // 末尾の「 - サイト名」を大まかに削る
          .trim();
      }
      return title;
    } catch (e) {
      console.warn(LOG, '商品名の取得に失敗:', e);
      return '';
    }
  }

  function getPrice(jsonLd) {
    try {
      const el = findFirst(selectorsFor('price'));
      let n = parseNumber(textOf(el) || (el && el.getAttribute('content')));
      if (n !== null && n > 0) return n;

      if (jsonLd.price !== null && jsonLd.price > 0) return jsonLd.price;

      const metaPrice = readMeta(['product:price:amount', 'og:price:amount']);
      n = parseNumber(metaPrice);
      if (n !== null && n > 0) return n;

      // 最終手段：class名に price を含む要素を広めに探す
      const candidates = Array.from(document.querySelectorAll('[class*="rice"]')).slice(0, 50);
      for (const c of candidates) {
        const v = parseNumber(textOf(c));
        if (v !== null && v > 0 && v < 100000000) return v;
      }
      return null;
    } catch (e) {
      console.warn(LOG, '価格の取得に失敗:', e);
      return null;
    }
  }

  function getOriginalPrice() {
    try {
      const el = findFirst(selectorsFor('originalPrice'));
      return parseNumber(textOf(el));
    } catch (e) {
      return null;
    }
  }

  /** 通貨：プロフィール → JSON-LD → メタタグ → 日本円と仮定 */
  function getCurrency(jsonLd) {
    if (profile && profile.currency) return profile.currency;
    if (jsonLd.currency) return jsonLd.currency;
    const metaCur = readMeta(['product:price:currency', 'og:price:currency']);
    if (metaCur) return metaCur;
    return 'JPY';
  }

  // ---------- カラー・サイズ ----------

  /** サイト専用プロフィールの skuGroups から属性を取る（Taobao など） */
  function getSkuPropsFromProfile() {
    const props = [];
    if (!profile || !profile.skuGroups) return props;
    try {
      for (const g of profile.skuGroups) {
        for (const groupEl of document.querySelectorAll(g.group)) {
          const name = textOf(groupEl.querySelector(g.label));
          const values = [];
          for (const v of groupEl.querySelectorAll(g.value)) {
            const t = v.tagName === 'IMG' ? (v.alt || '').trim() : textOf(v);
            if (t && !values.includes(t)) values.push(t);
          }
          if (name && values.length > 0) props.push({ name, values });
        }
        if (props.length > 0) break;
      }
    } catch (e) {
      console.warn(LOG, 'SKUの取得に失敗:', e);
    }
    return props;
  }

  /** 汎用：<select> やラジオボタンの選択肢からカラー・サイズらしいものを探す */
  function getSkuPropsGeneric() {
    const props = [];
    try {
      // <select> 要素
      for (const sel of document.querySelectorAll('select')) {
        const label =
          textOf(document.querySelector('label[for="' + sel.id + '"]')) ||
          sel.getAttribute('aria-label') || sel.name || sel.id || '';
        const values = [];
        for (const opt of sel.options) {
          const t = textOf(opt);
          if (t && !COMMON.placeholderWords.test(t) && !values.includes(t)) values.push(t);
        }
        if (label && values.length > 0) props.push({ name: label, values });
      }

      // ラジオボタンのグループ（name属性ごとにまとめる）
      const radioGroups = {};
      for (const r of document.querySelectorAll('input[type="radio"][name]')) {
        const t = textOf(r.closest('label')) || r.value || '';
        if (!t) continue;
        (radioGroups[r.name] = radioGroups[r.name] || []).push(t);
      }
      for (const [name, values] of Object.entries(radioGroups)) {
        const unique = values.filter((v, i) => values.indexOf(v) === i);
        if (unique.length > 0) props.push({ name, values: unique });
      }
    } catch (e) {
      console.warn(LOG, '選択肢の取得に失敗:', e);
    }
    return props;
  }

  /** 属性一覧から「カラーらしいもの」「サイズらしいもの」を選び出す */
  function pickColorsAndSizes(skuProps) {
    let colors = [];
    let sizes = [];
    for (const p of skuProps) {
      if (COMMON.colorWords.test(p.name) && colors.length === 0) colors = p.values;
      else if (COMMON.sizeWords.test(p.name) && sizes.length === 0) sizes = p.values;
    }
    return { colors, sizes };
  }

  // ---------- 画像の取得 ----------

  /**
   * 画像URLを整える。
   * プロフィールに imageUrlCut があれば（例: Taobao）、
   * サムネイルURLを大きい元画像のURLに変換する。
   */
  function normalizeImageUrl(url) {
    if (!url) return '';
    let u = String(url).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (!/^https?:\/\//i.test(u)) return '';
    if (profile && profile.imageUrlCut) {
      const m = u.match(profile.imageUrlCut);
      if (m) return m[1];
    }
    return u;
  }

  function isExcludedImage(url) {
    const patterns = COMMON.excludeImagePatterns.concat(
      (profile && profile.extraExcludePatterns) || []
    );
    return patterns.some((re) => re.test(url));
  }

  /** img要素から実際のURLを取り出す（遅延読み込み・srcsetにも対応） */
  function urlFromImg(img) {
    // srcset があれば一番最後（普通は一番大きい）を使う
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const parts = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
    return (
      img.currentSrc ||
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-ks-lazyload') ||
      img.getAttribute('data-lazyload') ||
      ''
    );
  }

  function getImages(jsonLd) {
    const seen = new Set();
    const images = []; // [{ url, kind }]  kind: main=商品画像 / detail=説明画像 / other

    function add(rawUrl, kind, imgEl) {
      try {
        const url = normalizeImageUrl(rawUrl);
        if (!url) return;
        // 重複判定は「?」より前の部分で行う（同じ画像のサイズ違いをまとめる）
        const key = url.split('?')[0];
        if (seen.has(key)) return;
        if (isExcludedImage(url)) return;

        const w = imgEl ? (imgEl.naturalWidth || imgEl.width || 0) : 0;
        const h = imgEl ? (imgEl.naturalHeight || imgEl.height || 0) : 0;
        const looksLikeProduct = ((profile && profile.productImagePatterns) || [])
          .some((re) => re.test(url));

        // 小さい画像（アイコン等）は除外。サイズ不明(0)は main/detail 由来なら通す
        if (w > 0 && h > 0 && (w < COMMON.minImageSize || h < COMMON.minImageSize) && kind !== 'main') {
          return;
        }
        if (w === 0 && h === 0 && kind === 'other' && !looksLikeProduct) {
          return;
        }

        seen.add(key);
        images.push({ url, kind });
      } catch (e) { /* 1枚の失敗で全体は止めない */ }
    }

    try {
      // ① ギャラリー（メイン画像＋サムネイル）
      const mainEl = findFirst(selectorsFor('mainImage'));
      if (mainEl && mainEl.tagName === 'IMG') add(urlFromImg(mainEl), 'main', mainEl);
      for (const img of findAll(selectorsFor('thumbImages'))) {
        add(urlFromImg(img), 'main', img);
      }

      // ② JSON-LD・OGP に書かれた公式の商品画像
      for (const u of jsonLd.images) add(u, 'main', null);
      for (const u of readMetaAll('og:image')) add(u, 'main', null);

      // ③ 商品説明エリアの画像
      const detailEl = findFirst(selectorsFor('detailArea'));
      if (detailEl) {
        for (const img of detailEl.querySelectorAll('img')) {
          add(urlFromImg(img), 'detail', img);
        }
      }

      // ④ ページ全体から、ある程度大きい画像を拾う（重複は自動で捨てられる）
      for (const img of document.querySelectorAll('img')) {
        add(urlFromImg(img), 'other', img);
      }
    } catch (e) {
      console.warn(LOG, '画像の取得中にエラー:', e);
    }

    return images.slice(0, COMMON.maxImages);
  }

  // ---------- ここから実行 ----------

  console.log(LOG, '取り込みを開始します:', location.href);

  const jsonLd = readJsonLd();

  let skuProps = getSkuPropsFromProfile();
  if (skuProps.length === 0) skuProps = getSkuPropsGeneric();
  const { colors, sizes } = pickColorsAndSizes(skuProps);

  const result = {
    ok: true,
    scrapedAt: new Date().toISOString(),
    url: location.href,
    site: location.hostname,
    profileId: profile ? profile.id : 'generic',
    productId: getProductId(),
    title: getTitle(jsonLd),            // 元サイトのタイトル
    priceOriginal: getPrice(jsonLd),    // 元サイトの価格（取れなければ null）
    listPriceOriginal: getOriginalPrice(), // 定価・打ち消し価格（あれば）
    currency: getCurrency(jsonLd),      // 'CNY' 'JPY' など
    colors,
    sizes,
    skuProps,
    images: getImages(jsonLd)           // [{ url, kind }]
  };

  console.log(LOG, '取り込み結果:', result);
  return result;
})();
