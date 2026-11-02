const $ = (id) => document.getElementById(id);
let current = null;

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  Object.assign(e, attrs || {});
  if (text != null) e.textContent = text;
  return e;
}

function render(p) {
  current = p;
  $('result').hidden = false;
  $('title').textContent = p.title || '（商品名なし）';
  $('price').textContent = p.price
    ? (p.price.min === p.price.max ? `¥${p.price.min}` : `¥${p.price.min} 〜 ¥${p.price.max}`) + '（人民元）'
    : '価格なし';

  $('warnings').replaceChildren(...p.warnings.map((w) => el('li', null, w)));
  if (!p.complete) {
    $('warnings').append(el('li', null, '足りない項目は、あとでスクリーンショットから補えるようにする予定です'));
  }

  $('skus').replaceChildren(
    ...p.skus.map((g) => {
      const d = el('div', { className: 'sku' }, g.name + '：');
      g.values.forEach((v) => d.append(el('span', { className: 'chip' + (v.disabled ? ' off' : '') }, v.name)));
      return d;
    })
  );

  $('specs').replaceChildren(
    ...p.specs.map((s) => {
      const tr = el('tr');
      tr.append(el('td', null, s.name), el('td', null, s.value));
      return tr;
    })
  );

  $('imgcount').textContent = `(${p.images.length})`;
  $('images').replaceChildren(...p.images.map((src) => el('img', { src, referrerPolicy: 'no-referrer' })));
}

async function extract() {
  $('status').textContent = '読み取り中…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PRODUCT' });
    if (!res || !res.ok) throw new Error((res && res.error) || '結果が返ってきませんでした');
    render(res.product);
    $('status').textContent = '取れました';
    // 履歴として最新50件を保存（後の段階でサーバーに送る）
    const { history = [] } = await chrome.storage.local.get('history');
    history.unshift(res.product);
    await chrome.storage.local.set({ history: history.slice(0, 50) });
  } catch (e) {
    $('status').textContent =
      'このページでは読み取れませんでした。タオバオ／天猫の商品ページを開いてから、ページを再読み込みしてもう一度押してください。';
  }
}

$('extract').addEventListener('click', extract);
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
  $('status').textContent = 'コピーしました';
});
$('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `taobao_${current.itemId || 'item'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
