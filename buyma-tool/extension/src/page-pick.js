/*
 * ページそのものの中（MAIN）で動く部品。BUYMA の画面のしくみ（React）に、カテゴリの候補を押したときの処理を直接お願いする。
 * ページ側の Promise が置き換えられていても結果を受け取れるよう、結果は <html> の data-raku-cat に JSON で書く。
 */
(function () {
  'use strict';
  async function pickCategoryInPage(i, want) {
    const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '');
    // ページ側で Promise が置き換えられていても動くよう、本物の Promise を使う
    const P = (async () => {})().constructor;
    const wait = (ms) => new P((r) => setTimeout(r, ms));
    const head = Array.from(document.querySelectorAll('.bmm-c-summary__ttl')).find((h) => norm(h.textContent) === 'カテゴリ');
    const row = head && head.closest('.bmm-l-grid');
    if (!row) return { name: '', info: 'カテゴリの欄が見つかりません' };
    const sel = () => row.querySelectorAll('.Select')[i];
    const label = () => {
      const v = sel() && sel().querySelector('.Select-value-label, .Select-value');
      return v ? v.textContent.trim() : '';
    };
    const props = (el) => {
      const k = Object.keys(el).find((x) => x.startsWith('__reactProps$') || x.startsWith('__reactEventHandlers$'));
      if (k) return el[k];
      const f = Object.keys(el).find((x) => x.startsWith('__reactInternalInstance$') || x.startsWith('__reactFiber$'));
      if (!f) return null;
      const inst = el[f];
      return (inst && (inst.memoizedProps || (inst._currentElement && inst._currentElement.props))) || null;
    };
    const text = (o) => {
      const m = o.querySelector('.bmm-c-select-option__main');
      const n = o.querySelector('.bmm-c-select-option__note');
      return m && n ? m.textContent.trim() + '（' + n.textContent.trim() + '）' : o.textContent.trim();
    };
    const fake = (type) => ({ type, button: 0, preventDefault() {}, stopPropagation() {}, persist() {}, nativeEvent: {} });
    if (!sel()) return { name: '', info: i + 1 + '段目の欄がありません' };
    // 一覧を開く（開いていなければ、欄のしくみに「押された」と伝える）
    if (!sel().querySelector('.Select-option')) {
      const control = sel().querySelector('.Select-control');
      const p = control && props(control);
      if (p && p.onMouseDown) p.onMouseDown(fake('mousedown'));
      else if (control) control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      for (let n = 0; n < 20 && !sel().querySelector('.Select-option'); n++) await wait(100);
    }
    const opt = Array.from(sel().querySelectorAll('.Select-option')).find((o) => norm(text(o)) === norm(want) || norm(o.textContent) === norm(want));
    if (!opt) return { name: '', info: '候補「' + want + '」が見つかりません' };
    const p = props(opt);
    if (!p) return { name: '', info: '画面のしくみに届きませんでした' };
    if (p.onMouseDown) p.onMouseDown(fake('mousedown'));
    else if (p.onClick) p.onClick(fake('click'));
    else if (p.onSelect) p.onSelect(p.option, fake('mousedown'));
    for (let n = 0; n < 60; n++) {
      await wait(100);
      const any = Array.from(row.querySelectorAll('.Select .Select-value-label, .Select .Select-value')).map((v) => v.textContent.trim()).filter(Boolean);
      if (label() || any.length) return { name: label() || any[Math.min(i, any.length - 1)], info: 'ページのしくみで選びました' };
    }
    return { name: '', info: '画面のしくみに頼みましたが、選ばれませんでした' };
  }

  window.__rakuPickCategory = function (i, want) {
    document.documentElement.removeAttribute('data-raku-cat');
    const done = (r) => document.documentElement.setAttribute('data-raku-cat', JSON.stringify(r || { name: '', info: '結果なし' }));
    try {
      pickCategoryInPage(i, want).then(done, (e) => done({ name: '', info: 'エラー：' + String(e && e.message).slice(0, 80) }));
    } catch (e) {
      done({ name: '', info: 'エラー：' + String(e && e.message).slice(0, 80) });
    }
    return 'started';
  };
})();
