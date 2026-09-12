/**
 * extractor.js
 * ============================================================
 * ポップアップの「この商品を取り込む」ボタンを押したときだけ、
 * いま表示している商品ページ(1ページのみ)に注入されて実行されます。
 *
 * ・ページの自動巡回や別ページへのアクセスは一切しません
 * ・すでにブラウザに読み込まれている内容だけを読み取ります
 * ・取得できない項目があっても止まらず、warnings に記録して続行します
 * ・セレクタは selectors.js(window.TAOBAO_SELECTORS)にまとめてあります
 *
 * 結果は chrome.runtime.sendMessage でポップアップへ返します。
 * ============================================================
 */

(function () {
  'use strict';

  var LOG_PREFIX = '[MAMC取込]';

  function log() {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, [LOG_PREFIX].concat(args));
  }

  try {
    var S = window.TAOBAO_SELECTORS;
    if (!S) {
      throw new Error('selectors.js が読み込まれていません');
    }

    var warnings = []; // 取得に失敗した項目のメモ

    // ------------------------------------------------------------
    // 小さな道具たち
    // ------------------------------------------------------------

    /** 候補セレクタを上から試し、最初に見つかった要素を返す */
    function findFirst(selectorList, root) {
      var base = root || document;
      for (var i = 0; i < selectorList.length; i++) {
        try {
          var el = base.querySelector(selectorList[i]);
          if (el) return el;
        } catch (e) { /* 無効なセレクタはスキップ */ }
      }
      return null;
    }

    /** 候補セレクタを上から試し、最初に「1件以上」見つかった要素リストを返す */
    function findAll(selectorList, root) {
      var base = root || document;
      for (var i = 0; i < selectorList.length; i++) {
        try {
          var els = base.querySelectorAll(selectorList[i]);
          if (els && els.length > 0) return Array.prototype.slice.call(els);
        } catch (e) { /* 無効なセレクタはスキップ */ }
      }
      return [];
    }

    /** 要素のテキストを取り出す(前後の空白を削除) */
    function textOf(el) {
      if (!el) return '';
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    /** 「¥128.00」「158-299」などの文字列から最初の数値を取り出す */
    function parsePrice(text) {
      if (!text) return null;
      var cleaned = String(text).replace(/[,，¥￥元\s]/g, '');
      var m = cleaned.match(/\d+(?:\.\d+)?/);
      if (!m) return null;
      var n = parseFloat(m[0]);
      return isFinite(n) && n > 0 ? n : null;
    }

    // ------------------------------------------------------------
    // 商品URL・商品ID
    // ------------------------------------------------------------

    function extractUrlAndId() {
      var url = location.href;
      var itemId = null;
      try {
        itemId = new URLSearchParams(location.search).get('id');
      } catch (e) { /* 古いブラウザ対策 */ }
      if (!itemId) {
        var m = url.match(/[?&]id=(\d+)/);
        if (m) itemId = m[1];
      }
      if (!itemId) {
        warnings.push('Taobao商品IDがURLから見つかりませんでした');
      }
      // 保存用にはURLをシンプルにする(id だけ残す)
      var cleanUrl = url;
      if (itemId) {
        cleanUrl = location.origin + location.pathname + '?id=' + itemId;
      }
      return { url: cleanUrl, itemId: itemId || '' };
    }

    // ------------------------------------------------------------
    // 商品名
    // ------------------------------------------------------------

    function extractTitle() {
      var el = findFirst(S.title);
      var title = textOf(el);
      if (!title) {
        // 最後の手段: ページタイトルから「-淘宝网」などを削って使う
        title = (document.title || '')
          .replace(/[-_|]?\s*(淘宝网|淘寶網|taobao|天猫|tmall).*$/i, '')
          .trim();
        if (title) {
          warnings.push('商品名はページタイトルから推定しました');
        }
      }
      if (!title) warnings.push('商品名を取得できませんでした');
      return title;
    }

    // ------------------------------------------------------------
    // 価格(人民元)
    // ------------------------------------------------------------

    function extractCurrentPrice() {
      for (var i = 0; i < S.currentPrice.length; i++) {
        var el = null;
        try { el = document.querySelector(S.currentPrice[i]); } catch (e) {}
        var price = parsePrice(textOf(el));
        if (price !== null) return price;
      }
      warnings.push('現在価格を取得できませんでした(確認画面で手入力してください)');
      return null;
    }

    function extractOriginalPrice() {
      for (var i = 0; i < S.originalPrice.length; i++) {
        var el = null;
        try { el = document.querySelector(S.originalPrice[i]); } catch (e) {}
        var price = parsePrice(textOf(el));
        if (price !== null) return price;
      }
      return null; // 通常価格は無いことも多いので warning にはしない
    }

    // ------------------------------------------------------------
    // 画像
    // ------------------------------------------------------------

    /**
     * 画像URLを整える
     * ・「//img.alicdn.com/...」→「https://img.alicdn.com/...」
     * ・「xxx.jpg_460x460q90.jpg_.webp」のような縮小サムネイル表記を
     *   「xxx.jpg」(元サイズ)に戻す
     * ・同じ画像の重複判定にもこの整えたURLを使う
     */
    function normalizeImageUrl(raw) {
      if (!raw) return null;
      var url = String(raw).trim();
      if (url.indexOf('data:') === 0) return null;      // 埋め込み画像は除外
      if (url.indexOf('//') === 0) url = 'https:' + url;
      if (url.indexOf('http') !== 0) return null;
      url = url.split('#')[0].split('?')[0];
      var m = url.match(/^(.*?\.(?:jpg|jpeg|png|webp))(?:_.*)?$/i);
      if (m) url = m[1];
      // 「xxx.jpg_.webp」の残り対策
      url = url.replace(/_\.webp$/i, '');
      return url;
    }

    /** 商品と無関係そうな画像を除外する判定 */
    function isExcludedImage(url) {
      var lower = url.toLowerCase();
      var f = S.imageFilter;
      var hostOk = false;
      for (var i = 0; i < f.includeHosts.length; i++) {
        if (lower.indexOf(f.includeHosts[i]) !== -1) { hostOk = true; break; }
      }
      if (!hostOk) return true;
      for (var j = 0; j < f.excludeKeywords.length; j++) {
        if (lower.indexOf(f.excludeKeywords[j]) !== -1) return true;
      }
      return false;
    }

    /** img要素の表示サイズ/実サイズが小さすぎるか(不明なら false = 残す) */
    function isTooSmall(imgEl) {
      var min = S.imageFilter.minEdge;
      var w = imgEl.naturalWidth || imgEl.width || 0;
      var h = imgEl.naturalHeight || imgEl.height || 0;
      if (w === 0 && h === 0) return false; // サイズ不明はURL判定に任せる
      return Math.max(w, h) < min;
    }

    function extractImages() {
      var seen = {};   // 重複チェック用(整えたURL → true)
      var images = []; // 結果(ギャラリー画像を先頭にする)

      function push(rawUrl, imgEl) {
        var url = normalizeImageUrl(rawUrl);
        if (!url) return;
        if (seen[url]) return;
        if (isExcludedImage(url)) return;
        if (imgEl && isTooSmall(imgEl)) return;
        if (images.length >= S.imageFilter.maxImages) return;
        seen[url] = true;
        images.push(url);
      }

      // 1. ギャラリー(サムネイル)画像を優先して集める
      var galleryEls = [];
      for (var i = 0; i < S.galleryImages.length; i++) {
        try {
          var els = document.querySelectorAll(S.galleryImages[i]);
          for (var j = 0; j < els.length; j++) galleryEls.push(els[j]);
        } catch (e) {}
      }
      galleryEls.forEach(function (img) {
        push(img.currentSrc || img.src || img.getAttribute('data-src'), img);
      });
      var galleryCount = images.length;

      // 2. 商品説明エリアの画像
      findAll(S.descriptionImages).forEach(function (img) {
        push(img.currentSrc || img.src || img.getAttribute('data-src') ||
             img.getAttribute('data-ks-lazyload'), img);
      });

      // 3. ページ内のその他の画像(フィルタを通ったものだけ)
      var allImgs = document.getElementsByTagName('img');
      for (var k = 0; k < allImgs.length; k++) {
        var img = allImgs[k];
        push(img.currentSrc || img.src || img.getAttribute('data-src') ||
             img.getAttribute('data-ks-lazyload'), img);
      }

      log('画像取得: ギャラリー ' + galleryCount + '枚 / 合計 ' + images.length + '枚');
      if (images.length === 0) {
        warnings.push('商品画像を取得できませんでした(ページを下までスクロールすると読み込まれる場合があります)');
      }
      return images;
    }

    // ------------------------------------------------------------
    // SKU(カラー・サイズなど)
    // ------------------------------------------------------------

    function labelMatches(label, keywords) {
      for (var i = 0; i < keywords.length; i++) {
        if (label.indexOf(keywords[i]) !== -1) return true;
      }
      return false;
    }

    function extractSku() {
      var colors = [];
      var sizes = [];
      var otherLines = []; // カラー/サイズ以外のSKUグループのメモ

      var groups = findAll(S.skuGroups);
      log('SKUグループ数: ' + groups.length);

      groups.forEach(function (group) {
        var label = textOf(findFirst(S.skuGroupLabel, group));
        var values = [];
        var valueEls = findAll(S.skuValues, group);
        valueEls.forEach(function (el) {
          var v = textOf(el);
          // テキストが無い色見本などは img の alt を使う
          if (!v) {
            var img = el.querySelector ? el.querySelector('img[alt]') : null;
            if (img) v = (img.getAttribute('alt') || '').trim();
          }
          // 長すぎる文字列はSKU値ではないので捨てる
          if (v && v.length <= 40 && values.indexOf(v) === -1) values.push(v);
        });
        if (values.length === 0) return;

        if (labelMatches(label, S.colorLabelKeywords)) {
          colors = colors.concat(values);
        } else if (labelMatches(label, S.sizeLabelKeywords)) {
          sizes = sizes.concat(values);
        } else {
          otherLines.push((label || 'その他') + ': ' + values.join(' / '));
        }
      });

      if (groups.length === 0) {
        warnings.push('SKU(カラー・サイズ)を取得できませんでした');
      }
      return {
        colors: colors,
        sizes: sizes,
        skuText: otherLines.join('\n')
      };
    }

    // ------------------------------------------------------------
    // 実行(1回だけ・このページだけ)
    // ------------------------------------------------------------

    log('取り込みを開始します:', location.href);

    var urlInfo = extractUrlAndId();
    var sku = extractSku();
    var images = extractImages();

    var payload = {
      ok: true,
      url: urlInfo.url,
      itemId: urlInfo.itemId,
      title: extractTitle(),
      priceCny: extractCurrentPrice(),
      originalPriceCny: extractOriginalPrice(),
      mainImage: images.length > 0 ? images[0] : '',
      images: images,
      colors: sku.colors,
      sizes: sku.sizes,
      skuText: sku.skuText,
      warnings: warnings,
      extractedAt: new Date().toISOString()
    };

    log('取り込み結果:', payload);
    chrome.runtime.sendMessage({ type: 'MAMC_EXTRACT_RESULT', payload: payload });

  } catch (err) {
    console.error(LOG_PREFIX, '取り込み中にエラーが発生しました:', err);
    try {
      chrome.runtime.sendMessage({
        type: 'MAMC_EXTRACT_RESULT',
        payload: { ok: false, error: String(err && err.message ? err.message : err) }
      });
    } catch (e2) { /* ここで失敗したら諦める */ }
  }
})();
