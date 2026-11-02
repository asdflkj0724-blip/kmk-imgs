/*
 * BUYMA の出品画面に、作った出品データを入力する（content script）。
 * 入力するのは商品名・商品コメント・価格だけ。カテゴリ・ブランド・配送方法などは自分で選ぶ。
 * 「出品する」「公開」などのボタンは絶対に押さない。
 */
(function (root) {
  'use strict';

  const FIELD_SELECTOR =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]), textarea';
  const LABEL_SELECTOR = 'label, th, dt, legend, [class*="label"], [class*="Label"], [class*="title"], [class*="Title"], [class*="head"]';

  function norm(s) {
    return (s || '').replace(/[\s　]+/g, '').replace(/[*＊※]|必須|任意/g, '');
  }

  // 子要素の入力欄を含まない、見出しそのものの文字
  function ownText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, option').forEach((n) => n.remove());
    return norm(clone.textContent);
  }

  function isVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function fieldNear(label) {
    const doc = label.ownerDocument;
    const forId = label.getAttribute('for');
    if (forId) {
      const el = doc.getElementById(forId);
      if (el && el.matches(FIELD_SELECTOR)) return el;
    }
    const inside = label.querySelector(FIELD_SELECTOR);
    if (inside) return inside;
    // 見出しの近く（同じ行・同じまとまり）で、見出しより後ろにある最初の入力欄
    let node = label;
    for (let depth = 0; depth < 4 && node.parentElement; depth++) {
      node = node.parentElement;
      const fields = Array.from(node.querySelectorAll(FIELD_SELECTOR)).filter(
        (f) => label.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (fields.length) {
        // まとまりの中に別の項目の見出しが複数ある場合は、広すぎるので一番近いものだけ
        return fields[0];
      }
    }
    return null;
  }

  function findField(doc, spec) {
    const labels = Array.from(doc.querySelectorAll(LABEL_SELECTOR));
    const wanted = spec.labels.map(norm);
    const excluded = (spec.excludeLabels || []).map(norm);
    const passes = [
      (t, w) => t === w, // 完全一致を優先
      (t, w) => t.startsWith(w),
      (t, w) => t.includes(w),
    ];
    for (const test of passes) {
      for (const w of wanted) {
        for (const label of labels) {
          const t = ownText(label);
          if (!t || t.length > 30) continue;
          if (excluded.some((x) => t.includes(x))) continue;
          if (!test(t, w)) continue;
          const f = fieldNear(label);
          if (f && isVisible(f)) return f;
        }
      }
    }
    for (const sel of spec.selectors || []) {
      const f = doc.querySelector(sel);
      if (f && isVisible(f)) return f;
    }
    return null;
  }

  /** React などの画面でも反映されるよう、元の setter で値を入れてイベントを出す */
  function setValue(el, value) {
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, String(value));
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.blur();
  }

  function findDraftButton(doc, config) {
    const buttons = Array.from(doc.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], [role=button]'));
    for (const b of buttons) {
      const text = norm(b.tagName === 'INPUT' ? b.value : b.textContent);
      if (!text) continue;
      if (config.forbiddenButtonTexts.some((x) => text.includes(norm(x)))) continue;
      if (config.draftButtonTexts.some((x) => text.includes(norm(x)))) return b;
    }
    return null;
  }

  function showBanner(doc, text, isError) {
    let el = doc.getElementById('buyma-helper-banner');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'buyma-helper-banner';
      el.style.cssText =
        'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:8px;' +
        'font:14px/1.6 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);white-space:pre-line;';
      const close = doc.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', '閉じる');
      close.style.cssText = 'float:right;margin-left:8px;border:0;background:none;font-size:16px;cursor:pointer;color:inherit;';
      close.addEventListener('click', () => el.remove());
      el.appendChild(close);
      el.appendChild(doc.createElement('span'));
      doc.body.appendChild(el);
    }
    el.style.background = isError ? '#fde8e8' : '#e8f5ee';
    el.style.color = isError ? '#8a1c1c' : '#14532d';
    el.lastChild.textContent = text;
    return el;
  }

  /**
   * @param listing {title_ja, description_ja, price_jpy}
   * @param options {mode: 'fill'|'draft', config?}
   */
  function fillListing(doc, listing, options) {
    const config = (options && options.config) || root.BuymaConfig;
    const mode = options && options.mode === 'draft' ? 'draft' : 'fill';
    const values = { title: listing.title_ja, description: listing.description_ja, price: listing.price_jpy };
    const filled = [];
    const missing = [];
    for (const key of Object.keys(config.fields)) {
      const v = values[key];
      if (v === null || v === undefined || v === '') continue;
      const el = findField(doc, config.fields[key]);
      if (el) {
        setValue(el, v);
        filled.push(key);
      } else {
        missing.push(config.fields[key].label);
      }
    }

    let draftClicked = false;
    let draftButtonFound = false;
    if (mode === 'draft' && missing.length === 0) {
      const btn = findDraftButton(doc, config);
      draftButtonFound = !!btn;
      if (btn) {
        btn.click();
        draftClicked = true;
      }
    }

    const lines = [];
    if (missing.length) lines.push(`見つからなかった項目：${missing.join('、')}（手で入力してください）`);
    if (mode === 'draft' && draftClicked) lines.push('下書き保存のボタンを押しました。');
    else if (mode === 'draft' && missing.length === 0 && !draftButtonFound) lines.push('下書き保存のボタンが見つかりませんでした。');
    lines.unshift(missing.length ? '一部だけ入力しました。' : '入力しました。内容を確認して保存してください。');
    lines.push('カテゴリ・ブランド・配送方法・画像は自分で選んでください。');
    showBanner(doc, lines.join('\n'), missing.length > 0);

    return { ok: missing.length === 0, filled, missing, draftClicked, draftButtonFound };
  }

  function waitForForm(doc, config, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (findField(doc, config.fields.title)) return resolve(true);
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  root.BuymaFill = { fillListing, findField, setValue, findDraftButton, showBanner };

  // ここから下は拡張機能として動くときだけ（テストでは動かない）
  const inExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  if (!inExtension || !root.BuymaConfig || !root.BuymaConfig.pagePattern.test(location.href)) return;

  chrome.runtime.sendMessage({ type: 'BUYMA_FILL_GET' }, async (res) => {
    if (chrome.runtime.lastError || !res || !res.listing) return; // 順番入力の対象ではないページ
    const config = root.BuymaConfig;
    const ready = await waitForForm(document, config, config.waitForFormMs);
    let result;
    if (!ready) {
      showBanner(document, '出品画面の入力欄が見つかりませんでした。BUYMA にログインしているか確認してください。', true);
      result = { ok: false, filled: [], missing: ['出品画面'], draftClicked: false };
    } else {
      try {
        result = fillListing(document, res.listing, { mode: res.mode });
      } catch (e) {
        result = { ok: false, filled: [], missing: [], error: String((e && e.message) || e) };
      }
    }
    chrome.runtime.sendMessage({ type: 'BUYMA_FILL_RESULT', listingId: res.listing.id, result, pageUrl: location.href });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
