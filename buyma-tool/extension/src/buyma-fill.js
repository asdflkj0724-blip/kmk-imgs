/*
 * BUYMA の出品画面に、作った出品データを入れる（「BUYMAに反映」ボタンを押したときだけ動く）。
 * - 入れるのは、文字を入れる欄だけ（商品名・商品コメント・商品価格・買付先ショップ名・出品メモ）
 * - すでに文字が入っている欄は上書きしない
 * - ボタンは一切押さない（「出品する」も「下書き保存」も押さない。最後の確定はユーザー本人）
 * BUYMA の画面の作りは公開されていないため、欄は見出しの文字（スマホの出品画面で確認したもの）から探す。
 */
(function (root) {
  'use strict';

  /** 入れる欄。label は BUYMA の出品画面の見出し。exclude はまぎらわしい見出し */
  const FIELDS = [
    { key: 'title', label: '商品名', exclude: ['ブランド', 'モデル'] },
    { key: 'description', label: '商品コメント', exclude: [] },
    { key: 'price', label: '商品価格', exclude: ['参考価格', '通常出品価格'] },
    { key: 'shopName', label: '買付先ショップ名', exclude: [] },
    { key: 'memo', label: '出品メモ', exclude: [] },
  ];

  const FIELD_SELECTOR =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=search]), textarea';

  function norm(s) {
    return (s || '').replace(/[\s　]+/g, '');
  }

  /** 見出しの文字（「必須」「出品後の変更不可」などの添え書きは除く） */
  function headingText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, option, button').forEach((n) => n.remove());
    return norm(clone.textContent).replace(/必須|任意|\/?出品後の変更不可|[*＊※/／]/g, '');
  }

  function isUsable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** 見出しより後ろで、いちばん近い入力欄（間に別の見出しの欄をはさまない） */
  function fieldAfter(heading) {
    const forId = heading.getAttribute && heading.getAttribute('for');
    if (forId) {
      const el = heading.ownerDocument.getElementById(forId);
      if (el && el.matches(FIELD_SELECTOR)) return el;
    }
    let node = heading;
    for (let depth = 0; depth < 5 && node.parentElement; depth++) {
      node = node.parentElement;
      const f = Array.from(node.querySelectorAll(FIELD_SELECTOR)).find(
        (x) => heading.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (f) return f;
    }
    return null;
  }

  function findField(doc, spec) {
    const want = norm(spec.label);
    const candidates = Array.from(doc.querySelectorAll('label, th, dt, legend, h1, h2, h3, h4, h5, p, span, div'));
    // 文字がちょうど一致する見出しを優先し、なければ「見出しで始まる」もの
    for (const exact of [true, false]) {
      for (const el of candidates) {
        // 子に別の見出し候補をたくさん持つ大きな箱は飛ばす
        if (el.children.length > 6) continue;
        const t = headingText(el);
        if (!t || t.length > 20) continue;
        if (spec.exclude.some((x) => t.includes(norm(x)))) continue;
        if (exact ? t !== want : !t.startsWith(want)) continue;
        const f = fieldAfter(el);
        if (f && isUsable(f)) return f;
      }
    }
    return null;
  }

  /** React などの画面でも反映されるよう、元の仕組みで値を入れてイベントを出す */
  function setValue(el, value) {
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.dispatchEvent(new win.Event('blur', { bubbles: true }));
  }

  function showBanner(doc, lines, isError) {
    let el = doc.getElementById('rakushuppin-banner');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'rakushuppin-banner';
      el.style.cssText =
        'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:12px 16px;border-radius:8px;' +
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
    el.lastChild.textContent = lines.join('\n');
  }

  /**
   * @param values { title, description, price, shopName, memo }
   * @returns { filled: string[], skipped: string[], missing: string[] }（見出しの名前）
   */
  function fillBuyma(doc, values) {
    const filled = [];
    const skipped = [];
    const missing = [];
    for (const spec of FIELDS) {
      const v = values[spec.key];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const field = findField(doc, spec);
      if (!field) {
        missing.push(spec.label);
        continue;
      }
      if (String(field.value || '').trim() !== '') {
        skipped.push(spec.label); // 自分で入れた内容は消さない
        continue;
      }
      setValue(field, v);
      filled.push(spec.label);
    }
    const lines = [];
    if (filled.length) lines.push('ラク出品：' + filled.join('・') + ' を入れました。');
    if (skipped.length) lines.push('すでに入っていたので入れなかった欄：' + skipped.join('・'));
    if (missing.length) lines.push('見つからなかった欄：' + missing.join('・') + '（コピーして貼り付けてください）');
    lines.push('カテゴリ・ブランド・色とサイズ・配送方法・画像はご自身で選んでください。内容を確かめてから「出品する」を押してください。');
    showBanner(doc, lines, !filled.length);
    return { filled, skipped, missing };
  }

  const api = { fillBuyma, FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RakuBuymaFill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
