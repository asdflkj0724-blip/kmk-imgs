/*
 * ポップアップの「確認・修正」画面と、商品データ（サーバーに送る形）の行き来。DOM は使わない。
 */
(function (root) {
  'use strict';

  const CURRENCIES = ['CNY', 'KRW', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'TWD'];
  const SOLD_OUT = '（品切れ）';
  const COLOR_RE = /颜色|色|color|colour|カラー|색상|컬러|couleur|colore/i;
  const SIZE_RE = /尺码|尺寸|码|サイズ|size|사이즈|taille|taglia/i;

  /**
   * 拡張で取れた結果（タオバオ等の専用読み取り）とサーバーの AI の結果から、使う方を決める。
   * - 専用読み取りで全部取れていれば、それを使う（AI の費用がかからない）
   * - そうでなければ AI の結果を使い、AI が画像を見つけられなければ専用読み取りの画像を使う
   */
  function chooseProduct(siteProduct, serverProduct) {
    if (siteProduct && siteProduct.complete) return siteProduct;
    if (!serverProduct) return siteProduct || null;
    const p = Object.assign({}, serverProduct);
    if ((!p.images || !p.images.length) && siteProduct && siteProduct.images && siteProduct.images.length) {
      p.images = siteProduct.images.slice();
    }
    if (siteProduct && !p.itemId && siteProduct.itemId) p.itemId = siteProduct.itemId;
    if (siteProduct && !p.shopName && siteProduct.shopName) p.shopName = siteProduct.shopName;
    p.complete = !!(p.title && p.price && p.images && p.images.length);
    return p;
  }

  const lines = (s) =>
    String(s || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

  function valueLines(values) {
    return values.map((v) => v.name + (v.disabled ? SOLD_OUT : '')).join('\n');
  }

  /** 商品データ → 画面の入力欄の値 */
  function formFromProduct(p) {
    const colors = [];
    const sizes = [];
    const specs = (p.specs || []).map((s) => `${s.name}: ${s.value}`);
    for (const g of p.skus || []) {
      if (COLOR_RE.test(g.name)) colors.push(...g.values);
      else if (SIZE_RE.test(g.name)) sizes.push(...g.values);
      else specs.push(`${g.name}: ${g.values.map((v) => v.name).join(' / ')}`);
    }
    const currency = p.price && CURRENCIES.includes(p.price.currency) ? p.price.currency : 'CNY';
    return {
      title: p.title || '',
      priceMin: p.price ? String(p.price.min) : '',
      priceMax: p.price && p.price.max !== p.price.min ? String(p.price.max) : '',
      currency,
      colors: valueLines(colors),
      sizes: valueLines(sizes),
      specs: specs.join('\n'),
      images: (p.images || []).map((url) => ({ url, keep: true })),
    };
  }

  function parseValues(text) {
    return lines(text).map((l) => {
      const disabled = l.endsWith(SOLD_OUT);
      return { name: disabled ? l.slice(0, -SOLD_OUT.length).trim() : l, image: '', disabled };
    });
  }

  /** 画面の入力欄の値 → 商品データ（元の商品の source / itemId / url は引き継ぐ） */
  function productFromForm(form, base) {
    base = base || {};
    const min = parseFloat(String(form.priceMin).replace(/,/g, ''));
    const maxRaw = parseFloat(String(form.priceMax).replace(/,/g, ''));
    const price =
      Number.isFinite(min) && min > 0
        ? {
            min: Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(min, maxRaw) : min,
            max: Number.isFinite(maxRaw) && maxRaw > 0 ? Math.max(min, maxRaw) : min,
            currency: CURRENCIES.includes(form.currency) ? form.currency : 'CNY',
            raw: '',
          }
        : null;
    const skus = [];
    const colors = parseValues(form.colors);
    const sizes = parseValues(form.sizes);
    if (colors.length) skus.push({ name: 'カラー', values: colors });
    if (sizes.length) skus.push({ name: 'サイズ', values: sizes });
    const specs = lines(form.specs)
      .map((l) => {
        const i = l.search(/[:：]/);
        return i > 0 ? { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : null;
      })
      .filter((s) => s && s.name && s.value);
    const images = (form.images || []).filter((i) => i.keep).map((i) => i.url);
    const title = String(form.title || '').trim();
    return {
      source: base.source || 'unknown',
      itemId: base.itemId || '',
      url: base.url || '',
      shopName: base.shopName || '',
      title,
      price,
      skus,
      specs,
      images,
      complete: !!(title && price && images.length),
      warnings: [],
    };
  }

  /**
   * 商品IDがないサイト（タオバオ以外）では、URL から作った8文字の目印を商品IDにする。
   * サーバーに送る前に入れておくので、画像ZIPのファイル名と CSV の画像ファイル名がそろう。
   */
  function ensureItemId(p, hash) {
    if (!p.itemId) p.itemId = hash(p.url);
    return p;
  }

  /** 「全部まとめてコピー」用の文章 */
  function listingText(fields) {
    const order = [
      ['title', 'タイトル'],
      ['priceJpy', '価格（円）'],
      ['category', 'カテゴリー候補'],
      ['brand', 'ブランド'],
      ['colors', '色'],
      ['sizes', 'サイズ'],
      ['material', '素材'],
      ['shippingMethod', '配送方法'],
    ];
    const out = order.filter(([k]) => fields[k]).map(([k, label]) => `${label}：${fields[k]}`);
    if (fields.description) out.push('', '商品コメント：', fields.description);
    return out.join('\n');
  }

  /**
   * 配送方法の初めの選択：最後に選んだもの → サーバーの設定（登録済みの名前と完全に同じときだけ）→ 未選択。
   * 名前が一致しないものを勝手に選ばない。
   */
  function pickShipping(list, last, serverValue) {
    const names = Array.isArray(list) ? list : [];
    if (last && names.includes(last)) return last;
    if (serverValue && names.includes(serverValue)) return serverValue;
    return '';
  }

  /** 出品データのお知らせを、重さごとに分ける */
  function noticeItems(l) {
    const out = [];
    if (l.priceError) out.push({ level: 'warning', text: '【価格】' + l.priceError });
    for (const i of l.issues || []) {
      const tag = i.level === 'error' ? '【要修正】' : i.level === 'info' ? '【参考】' : '【確認】';
      out.push({ level: i.level, text: tag + i.message });
    }
    for (const c of l.cautions || []) out.push({ level: 'warning', text: '【確認】' + c });
    if ((l.missing || []).length) out.push({ level: 'info', text: '【ページに情報がなかった項目】' + l.missing.join('・') });
    for (const f of l.fixes || []) out.push({ level: 'fixed', text: '【自動で直しました】' + f });
    const order = { error: 0, warning: 1, info: 2, fixed: 3 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  /** BUYMA の数え方の文字数（半角は1、全角は2） */
  function buymaLength(s) {
    let n = 0;
    for (const c of Array.from(String(s || ''))) {
      const code = c.codePointAt(0);
      n += code <= 0x7e || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
    }
    return n;
  }

  /** BUYMA の出品画面に入れる値（「BUYMAに反映」用） */
  function buymaValues(listing, product) {
    const l = listing || {};
    const p = product || {};
    const price = Number(l.priceJpy);
    const memo = [];
    if (p.url) memo.push('仕入れ先：' + p.url);
    if (p.price && p.price.min) memo.push(`仕入れ値：${p.price.min}${p.price.max && p.price.max !== p.price.min ? '〜' + p.price.max : ''} ${p.price.currency || ''}`.trim());
    if (memo.length) memo.push('（ラク出品で作成）');
    return {
      title: l.title || '',
      description: l.description || '',
      price: Number.isFinite(price) && price > 0 ? String(Math.round(price)) : '',
      shopName: p.shopName || '',
      memo: memo.join('\n'),
    };
  }

  function isBuymaUrl(url) {
    try {
      return /(^|\.)buyma\.com$/.test(new URL(url).hostname);
    } catch (e) {
      return false;
    }
  }

  const api = { buymaValues, isBuymaUrl, buymaLength, CURRENCIES, chooseProduct, formFromProduct, productFromForm, ensureItemId, listingText, pickShipping, noticeItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaProductForm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
