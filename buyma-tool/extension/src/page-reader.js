/*
 * どのサイトでも使える読み取り：ページの中身（文章・JSON-LD・画像の候補）をまとめて取り出す。
 * ここでは「商品名はここ」といったサイトごとの決めつけはしない。抜き出しはサーバーの AI が行う。
 * DOM を読むだけで、外部への通信は一切しない。
 */
(function (root) {
  'use strict';

  const LIMITS = { jsonLd: 20000, pageText: 15000, images: 40 };
  // 本文から外すもの（メニュー・フッターなど、商品と関係ない部分）
  const NOISE = 'script, style, noscript, template, svg, iframe, nav, footer, header, form, [aria-hidden="true"], [hidden]';
  const BAD_IMAGE = /(icon|logo|sprite|favicon|avatar|badge|loading|placeholder|blank|spacer|pixel|tracking)/i;

  function collapse(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function meta(doc, name) {
    const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? collapse(el.getAttribute('content')) : '';
  }

  function absolute(doc, src) {
    if (!src) return '';
    const s = String(src).trim();
    if (!s || s.startsWith('data:') || s.startsWith('blob:')) return '';
    try {
      const u = new URL(s, doc.baseURI || (doc.location && doc.location.href) || undefined);
      if (u.protocol === 'http:') u.protocol = 'https:';
      if (u.protocol !== 'https:') return '';
      u.hash = '';
      return u.href;
    } catch (e) {
      return '';
    }
  }

  /** srcset の中でいちばん大きい画像 */
  function largestFromSrcset(srcset) {
    let best = '';
    let bestW = -1;
    for (const part of String(srcset || '').split(',')) {
      const [url, size] = part.trim().split(/\s+/);
      if (!url) continue;
      const w = size ? parseFloat(size) * (size.endsWith('x') ? 1000 : 1) : 0;
      if (w > bestW) {
        bestW = w;
        best = url;
      }
    }
    return best;
  }

  function jsonLdText(doc) {
    const parts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent.trim());
    return parts.join('\n').slice(0, LIMITS.jsonLd);
  }

  /** JSON-LD の中の "image"（文字列・配列・{url}）を集める */
  function jsonLdImages(doc) {
    const out = [];
    const walk = (v, key) => {
      if (!v) return;
      if (typeof v === 'string') {
        if (key === 'image' || key === 'contentUrl' || key === 'url') out.push(v);
        return;
      }
      if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
      if (typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'image') walk(x, 'image');
          else if (key === 'image' && (k === 'url' || k === 'contentUrl')) walk(x, k);
          else if (typeof x === 'object') walk(x, k);
        }
      }
    };
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(s.textContent), '');
      } catch (e) {
        // 壊れた JSON-LD は飛ばす
      }
    }
    return out;
  }

  function mainRoot(doc) {
    return (
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.querySelector('[itemtype*="schema.org/Product"]') ||
      doc.querySelector('article') ||
      doc.body
    );
  }

  function pageText(doc) {
    const rootEl = mainRoot(doc);
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach((n) => n.remove());
    return collapse(clone.textContent).slice(0, LIMITS.pageText);
  }

  function imgSize(img) {
    const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    return Math.max(w, h);
  }

  function candidateImages(doc) {
    const urls = [];
    const og = meta(doc, 'og:image');
    if (og) urls.push(og);
    urls.push(...jsonLdImages(doc));
    for (const img of doc.querySelectorAll('img')) {
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      const src =
        largestFromSrcset(srcset) ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-ks-lazyload') ||
        img.getAttribute('src');
      // 小さい画像（アイコン・ボタンなど）は外す。大きさがわからないものは srcset があれば残す
      const size = imgSize(img);
      if (size > 0 ? size < 300 : !srcset) continue;
      urls.push(src);
    }
    const seen = new Set();
    const out = [];
    for (const raw of urls) {
      const u = absolute(doc, raw);
      if (!u || BAD_IMAGE.test(u) || /\.svg(\?|$)/i.test(u) || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= LIMITS.images) break;
    }
    return out;
  }

  function readPage(doc, url) {
    const pageUrl = url || (doc.location && doc.location.href) || '';
    return {
      url: pageUrl,
      title: collapse(doc.title),
      metaDescription: meta(doc, 'description') || meta(doc, 'og:description'),
      ogImage: absolute(doc, meta(doc, 'og:image')),
      jsonLd: jsonLdText(doc),
      pageText: pageText(doc),
      images: candidateImages(doc),
    };
  }

  /**
   * URL から8文字の目印（16進）を作る。タオバオ以外は商品IDがないので、
   * 画像ZIPのファイル名とサーバーの CSV（item_id）をこれでそろえる。
   * クエリ（?以降）は広告の目印などで変わるので使わない。
   */
  function shortHash(url) {
    let key = String(url || '');
    try {
      const u = new URL(key);
      key = u.origin + u.pathname;
    } catch (e) {
      // URL でなければそのまま
    }
    let h = 0x811c9dc5; // FNV-1a 32bit
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  const api = { readPage, shortHash, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaPageReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
