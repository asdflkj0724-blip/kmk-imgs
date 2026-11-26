/*
 * タオバオ／天猫の商品ページから情報を取り出す処理。
 * DOM だけを読み、外部への通信は一切しない。
 * ページの作りは時期によって違うため、新旧いくつかのレイアウトを順に試す。
 */
(function (root) {
  'use strict';

  // class 名の一部で探す（新しいページは "mainTitle--3d8f" のように末尾が変わるため）
  function cls(part) {
    return '[class*="' + part + '"]';
  }

  function text(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function first(scope, selectors) {
    for (const s of selectors) {
      const el = scope.querySelector(s);
      if (el && text(el)) return el;
    }
    return null;
  }

  function all(scope, selectors) {
    for (const s of selectors) {
      const list = Array.from(scope.querySelectorAll(s));
      if (list.length) return list;
    }
    return [];
  }

  function meta(doc, prop) {
    const el = doc.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  // 画像URLを原寸にそろえる：//→https:、_60x60q90.jpg などのサムネイル指定を外す
  function normalizeImageUrl(src) {
    if (!src) return '';
    let u = String(src).trim();
    if (!u || u.startsWith('data:')) return '';
    if (u.startsWith('//')) u = 'https:' + u;
    u = u.replace(/^http:\/\//, 'https://');
    u = u.replace(/(\.(?:jpe?g|png|webp|gif))_[^/]*$/i, '$1');
    return u;
  }

  function imageOf(el) {
    if (!el) return '';
    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (img) {
      return normalizeImageUrl(
        img.getAttribute('data-src') || img.getAttribute('data-ks-lazyload') || img.getAttribute('src')
      );
    }
    // 旧ページは背景画像に色見本が入っている
    const a = el.tagName === 'A' ? el : el.querySelector('a');
    const style = (a && a.getAttribute('style')) || el.getAttribute('style') || '';
    const m = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
    return m ? normalizeImageUrl(m[1]) : '';
  }

  function parsePrice(raw) {
    const nums = (raw || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    if (!nums) return null;
    const values = nums.map(Number);
    return {
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
      currency: 'CNY',
      raw: raw.trim(),
    };
  }

  function detectSource(url) {
    if (/(^|\.)tmall\.(com|hk)$/.test(hostOf(url))) return 'tmall';
    if (/(^|\.)taobao\.com$/.test(hostOf(url))) return 'taobao';
    return 'unknown';
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  function itemIdOf(url) {
    try {
      return new URL(url).searchParams.get('id') || '';
    } catch (e) {
      return '';
    }
  }

  function extractTitle(doc) {
    const el = first(doc, [
      cls('mainTitle--'),
      cls('ItemHeader--mainTitle'),
      '#J_Title .tb-main-title',
      '.tb-detail-hd h1',
      '.tb-main-title',
    ]);
    if (el) return text(el);
    const og = meta(doc, 'og:title');
    if (og) return og;
    return (doc.title || '').replace(/[-–|].*(淘宝|天猫|tmall|taobao).*$/i, '').trim();
  }

  function extractPrice(doc) {
    // 割引後の価格を優先し、なければ通常価格
    const el = first(doc, [
      cls('highlightPrice--') + ' ' + cls('text--'),
      cls('Price--priceText--'),
      cls('priceText--'),
      '#J_PromoPriceNum',
      '.tm-promo-price .tm-price',
      '#J_StrPrice .tb-rmb-num',
      '.tm-price',
    ]);
    return el ? parsePrice(text(el)) : null;
  }

  function extractSkus(doc) {
    // 新レイアウト
    const groups = all(doc, [cls('skuItem--'), cls('SkuContent--skuItem')]);
    if (groups.length) {
      return groups
        .map((g) => {
          const name = text(first(g, [cls('labelText--'), cls('ItemLabel--')]))
            .replace(/[:：]$/, '');
          const values = Array.from(g.querySelectorAll(cls('valueItem--')))
            .map((v) => ({
              name: text(first(v, [cls('valueItemText--')]) || v) || v.getAttribute('title') || '',
              image: imageOf(v),
              disabled: /isDisabled|disabled/i.test(v.className),
            }))
            .filter((v) => v.name);
          return { name, values };
        })
        .filter((g) => g.name && g.values.length);
    }
    // 旧レイアウト（タオバオ／天猫共通）
    return Array.from(doc.querySelectorAll('ul.J_TSaleProp, .tb-sku dl ul[data-property]'))
      .map((ul) => {
        let name = ul.getAttribute('data-property') || '';
        if (!name) {
          const dl = ul.closest('dl');
          name = text(dl && dl.querySelector('dt'));
        }
        const values = Array.from(ul.querySelectorAll('li'))
          .map((li) => ({
            name: text(li.querySelector('span')) || li.getAttribute('title') || text(li),
            image: imageOf(li),
            disabled: /tb-out-of-stock|disabled/i.test(li.className),
          }))
          .filter((v) => v.name);
        return { name: name.replace(/[:：]$/, ''), values };
      })
      .filter((g) => g.name && g.values.length);
  }

  function extractSpecs(doc) {
    const items = all(doc, [cls('infoItem--'), cls('emphasisParamsInfoItem--')]);
    if (items.length) {
      return items
        .map((it) => ({
          name: text(first(it, [cls('infoItemTitle--'), cls('ItemTitle--')])),
          value: text(first(it, [cls('infoItemContent--'), cls('ItemContent--')])),
        }))
        .filter((s) => s.name && s.value);
    }
    // 旧レイアウトは「名前: 値」の1行
    return Array.from(doc.querySelectorAll('#attributes .attributes-list li, #J_AttrUL li'))
      .map((li) => {
        const t = text(li);
        const i = t.search(/[:：]/);
        return i > 0
          ? { name: t.slice(0, i).trim(), value: t.slice(i + 1).trim() }
          : { name: '', value: t };
      })
      .filter((s) => s.name && s.value);
  }

  function extractImages(doc) {
    const nodes = all(doc, [
      cls('thumbnails--') + ' img',
      cls('PicGallery--thumbnailPic') ,
      cls('thumbnailPic--'),
      '#J_UlThumb img',
    ]);
    const urls = nodes.map(imageOf).filter(Boolean);
    const og = normalizeImageUrl(meta(doc, 'og:image'));
    if (!urls.length && og) urls.push(og);
    return Array.from(new Set(urls));
  }

  /**
   * 商品説明（ページの下のほう）の画像：着用写真・細部・サイズ表など。
   * 読み込み前の画像は data-src などに本当の URL が入っている。小さな飾りや透明の画像は除く。
   */
  function extractDescImages(doc) {
    const containers = Array.from(
      doc.querySelectorAll(
        [
          '#J_DivItemDesc',
          '#description',
          '.ke-post',
          cls('descV8'),
          cls('desc--'),
          cls('Desc--'),
          cls('detailDesc'),
          cls('imageTextInfo'),
          cls('graphicPic'),
        ].join(',')
      )
    );
    const urls = [];
    for (const c of containers) {
      for (const img of Array.from(c.querySelectorAll('img'))) {
        const src = normalizeImageUrl(
          img.getAttribute('data-src') ||
            img.getAttribute('data-ks-lazyload') ||
            img.getAttribute('data-lazyload') ||
            img.getAttribute('src')
        );
        if (!src || /spaceball|blank|pixel|transparent|\.gif$/i.test(src)) continue;
        const w = Number(img.getAttribute('width')) || 0;
        const h = Number(img.getAttribute('height')) || 0;
        if ((w && w < 200) || (h && h < 100)) continue; // 小さな飾り
        urls.push(src);
      }
    }
    return urls;
  }

  /** お店の名前（BUYMA の「買付先ショップ名」に使う）。ブランド名とは別もの */
  function extractShopName(doc) {
    const el = first(doc, [
      cls('shopName--'),
      cls('ShopHeader--title'),
      cls('shopHeader--name'),
      '.tb-shop-name a',
      '.tb-shop-name',
      '.slogo-shopname',
      '.shop-name-link',
    ]);
    return el ? text(el).slice(0, 60) : '';
  }

  function extractProduct(doc, url) {
    const pageUrl = url || (doc.location && doc.location.href) || '';
    const skus = extractSkus(doc);
    // 画像の順番：メインの画像 → 色ごとの画像 → 商品説明の画像（着用写真・サイズ表など）。重複は除き、最大50枚
    const descAll = extractDescImages(doc);
    const images = Array.from(
      new Set([...extractImages(doc), ...skus.flatMap((g) => g.values.map((v) => v.image)).filter(Boolean), ...descAll])
    ).slice(0, 50);
    // 商品説明の画像は、1枚の長いポスターを細かく切って載せていることが多い。
    // 正方形にするときに「つなぎ直して、白いすき間で分ける」ため、どれが説明の画像かを残しておく
    const descImages = descAll.filter((u) => images.includes(u));
    const result = {
      source: detectSource(pageUrl),
      itemId: itemIdOf(pageUrl),
      url: pageUrl,
      shopName: extractShopName(doc),
      title: extractTitle(doc),
      price: extractPrice(doc),
      skus,
      specs: extractSpecs(doc),
      images,
      descImages,
      extractedAt: new Date().toISOString(),
      warnings: [],
    };
    if (!result.title) result.warnings.push('商品名が取れませんでした');
    if (!result.price) result.warnings.push('価格が取れませんでした');
    if (!result.images.length) result.warnings.push('画像が取れませんでした');
    if (!result.skus.length) result.warnings.push('SKU（色・サイズ）が見つかりませんでした');
    // 足りない項目があれば、スクリーンショットのアップロード（AIで補う）をすすめる
    result.complete = !!(result.title && result.price && result.images.length);
    return result;
  }

  const api = { extractProduct, normalizeImageUrl, parsePrice, detectSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaExtractor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
