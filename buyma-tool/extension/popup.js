const $ = (id) => document.getElementById(id);
const api = BuymaApi.createApi();
let TITLE_MAX = 60; // サーバー（/api/me の titleMax）から上書きする

let product = null; // 拡張で取った商品情報
let listing = null; // サーバーで作った出品データ
let tab = null;

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  Object.assign(e, attrs || {});
  if (text != null) e.textContent = text;
  return e;
}
function setStatus(text) {
  $('status').textContent = text || '';
}
const yen = (n) => (n == null ? '' : `¥${Number(n).toLocaleString('ja-JP')}`);

// ---- 画面を開いている間の状態（ポップアップを閉じても同じタブなら残す） ----
const stateKey = () => 'popup:' + (tab ? tab.url : '');
async function saveState() {
  try {
    await chrome.storage.session.set({ [stateKey()]: { product, listing } });
  } catch (e) {}
}
async function loadState() {
  try {
    const s = (await chrome.storage.session.get(stateKey()))[stateKey()];
    if (s) {
      product = s.product;
      listing = s.listing;
    }
  } catch (e) {}
}

// ---- ログイン状態 ----
// サーバーで「使えるアカウント」と確認できたときだけ true（お金を払っている、または無料お試し中）
let accountActive = false;
let inactiveMessage = 'ご利用には登録が必要です（無料お試しあり）。右上の「設定」から「ログインして連携する」を押してください。';

function requireActive() {
  if (accountActive) return true;
  setStatus(inactiveMessage);
  return false;
}

async function loadAccount() {
  accountActive = false;
  const auth = await api.getAuth();
  if (!auth) {
    $('account').textContent = 'ログインしていません。右上の「設定」から「ログインして連携する」を押すと使えるようになります（無料お試しあり）。';
    $('generate').disabled = true;
    return;
  }
  try {
    const me = await api.me();
    const a = me.allowance || {};
    if (me.titleMax > 0) TITLE_MAX = me.titleMax;
    accountActive = me.active === true;
    if (!accountActive) inactiveMessage = me.inactiveReason || inactiveMessage;
    $('account').textContent = `${me.email}｜${me.planName || me.plan}｜残り ${a.remaining ?? '-'} / ${a.limit ?? '-'} 件` + (a.reason ? `（${a.reason}）` : '');
    $('generate').disabled = a.allowed === false;
    const sel = $('template');
    sel.replaceChildren(el('option', { value: '' }, '（いつも使うテンプレート）'));
    for (const t of me.templates || []) {
      const o = el('option', { value: t.id }, t.name);
      if (t.is_default) o.selected = true;
      sel.append(o);
    }
  } catch (e) {
    $('account').textContent = e.message;
    $('generate').disabled = e.status === 401;
  }
}

// ---- 取った商品情報の表示 ----
function renderProduct(p) {
  $('result').hidden = false;
  $('title').textContent = p.title || '（商品名なし）';
  $('price').textContent = p.price
    ? (p.price.min === p.price.max ? `¥${p.price.min}` : `¥${p.price.min} 〜 ¥${p.price.max}`) + '（人民元）'
    : '価格なし';
  $('warnings').replaceChildren(...(p.warnings || []).map((w) => el('li', null, w)));
  $('vision').hidden = !!p.complete;

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

// ---- 出品データの表示と編集 ----
const BREAKDOWN_LABELS = [
  ['productJpy', '仕入れ値（円換算）'],
  ['agentFeeJpy', '代行手数料'],
  ['domesticShippingJpy', '中国国内送料'],
  ['dutyJpy', '関税など'],
  ['internationalShippingJpy', '国際送料'],
  ['otherCostJpy', 'その他'],
  ['totalCostJpy', '費用の合計'],
  ['buymaFeeJpy', 'BUYMA手数料'],
  ['profitJpy', '利益'],
];

function updateTitleCount() {
  const n = Array.from($('lTitle').value).length;
  $('titleCount').textContent = `${n} / ${TITLE_MAX}文字`;
  $('titleCount').className = 'small' + (n > TITLE_MAX ? ' over' : '');
}

function renderListing(l) {
  $('listing').hidden = false;
  $('lTitle').value = l.title || '';
  $('lDesc').value = l.description || '';
  $('lPrice').value = l.priceJpy ?? '';
  updateTitleCount();
  const b = l.breakdown;
  $('breakdownBox').hidden = !b;
  if (b) {
    const rows = BREAKDOWN_LABELS.filter(([k]) => b[k] != null).map(([k, label]) => {
      const tr = el('tr');
      tr.append(el('td', null, label), el('td', null, yen(b[k])));
      return tr;
    });
    const fx = el('tr');
    fx.append(el('td', null, '為替（上乗せ後）'), el('td', null, `1元 = ${b.effectiveFxRate}円`));
    rows.push(fx);
    $('breakdown').replaceChildren(...rows);
  }
  $('category').textContent = l.category ? `カテゴリの候補：${l.category}` : '';
  const items = [
    ...(l.issues || []).map((i) => el('li', { className: 'lv-' + i.level }, (i.level === 'error' ? '【要修正】' : '【注意】') + i.message)),
    ...(l.cautions || []).map((c) => el('li', { className: 'lv-warning' }, '【AIより】' + c)),
  ];
  $('issues').replaceChildren(...items);
}

function listingEdits() {
  const price = Number($('lPrice').value);
  return {
    title: $('lTitle').value.trim(),
    description: $('lDesc').value,
    priceJpy: Number.isFinite(price) && price > 0 ? Math.round(price) : undefined,
  };
}

// ---- 操作 ----
async function extract() {
  if (!requireActive()) return;
  setStatus('読み取り中…');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PRODUCT' });
    if (!res || !res.ok) throw new Error((res && res.error) || '結果が返ってきませんでした');
    product = res.product;
    listing = null;
    $('listing').hidden = true;
    renderProduct(product);
    setStatus(product.complete ? '取れました' : '一部の情報が取れませんでした。「スクショで補う」を試せます');
    const { history = [] } = await chrome.storage.local.get('history');
    history.unshift(product);
    await chrome.storage.local.set({ history: history.slice(0, 50) });
    await saveState();
  } catch (e) {
    setStatus('このページでは読み取れませんでした。タオバオ／天猫の商品ページを開いてから、ページを再読み込みしてもう一度押してください。');
  }
}

async function fillFromScreenshot() {
  setStatus('スクリーンショットを読み取り中…（10〜30秒ほど）');
  $('vision').disabled = true;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const { product: v } = await api.vision(base64, 'image/jpeg', tab.url);
    // 足りない項目だけ補う。画像は拡張で取ったものを使う
    if (!product.title && v.title) product.title = v.title;
    if (!product.price && v.price) product.price = v.price;
    if (!product.skus.length && v.skus && v.skus.length) product.skus = v.skus;
    if (!product.specs.length && v.specs && v.specs.length) product.specs = v.specs;
    product.warnings = (product.warnings || []).filter(
      (w) => !((w.includes('商品名') && product.title) || (w.includes('価格') && product.price) || (w.includes('SKU') && product.skus.length))
    );
    product.complete = !!(product.title && product.price && product.images.length);
    renderProduct(product);
    await saveState();
    setStatus('スクリーンショットから補いました');
    loadAccount();
  } catch (e) {
    setStatus(e.message || 'スクリーンショットを読み取れませんでした');
  } finally {
    $('vision').disabled = false;
  }
}

async function generate() {
  setStatus('AIで出品データを作っています…（10〜30秒ほど）');
  $('generate').disabled = true;
  try {
    const res = await api.generate(product, $('template').value, $('instruction').value.trim());
    listing = res.listing;
    renderListing(listing);
    await saveState();
    setStatus('できました。内容を確認して「保存」してください');
  } catch (e) {
    setStatus(e.message);
  } finally {
    $('generate').disabled = false;
    loadAccount();
  }
}

async function patchListing(extra, doneText) {
  if (!listing) return;
  try {
    const edits = listingEdits();
    await api.updateListing(listing.id, Object.assign(edits, extra || {}));
    Object.assign(listing, { title: edits.title, description: edits.description, priceJpy: edits.priceJpy ?? listing.priceJpy });
    await saveState();
    setStatus(doneText);
  } catch (e) {
    setStatus(e.message);
  }
}

async function downloadZip() {
  if (!requireActive()) return;
  if (!product || !product.images.length) return setStatus('画像がありません');
  const s = await api.getSettings();
  $('zip').disabled = true;
  try {
    const { zip, ok, failed } = await BuymaImages.buildImagesZip(
      product.images,
      product.itemId,
      { maxPx: s.imageMaxPx, quality: s.jpegQuality },
      (i, n) => setStatus(`画像を準備中… ${i}/${n}（このまま開いておいてください）`)
    );
    if (!ok) return setStatus('画像を1枚も取れませんでした');
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    await chrome.downloads.download({ url, filename: `taobao_${product.itemId || 'item'}_images.zip` });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(`${ok}枚をZIPにしました` + (failed.length ? `（${failed.join('・')}枚目は取れませんでした）` : ''));
  } catch (e) {
    setStatus('ZIPを作れませんでした：' + e.message);
  } finally {
    $('zip').disabled = false;
  }
}

// ---- 順番入力 ----
function renderQueue(q) {
  if (!q) return;
  $('queueStart').hidden = !!q.running;
  $('queueStop').hidden = !q.running;
  $('queueStatus').textContent = q.running
    ? `入力中：${Math.min(q.index + 1, q.items.length)} / ${q.items.length}件（${q.phase === 'waiting' ? '次まで待っています' : 'BUYMAに入力中'}）`
    : q.items && q.items.length
      ? `前回：入力 ${q.done || 0}件・失敗 ${q.failed || 0}件`
      : '';
  $('queueLog').replaceChildren(...(q.log || []).slice(-8).map((t) => el('li', null, t)));
}
async function queueCommand(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (res && res.ok) renderQueue(res.queue);
  else if (res && res.error) $('queueStatus').textContent = res.error;
}

// ---- はじめに ----
async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadState();
  if (product) renderProduct(product);
  if (listing) renderListing(listing);
  loadAccount();
  queueCommand('QUEUE_STATUS');
}

$('extract').addEventListener('click', extract);
$('vision').addEventListener('click', fillFromScreenshot);
$('generate').addEventListener('click', generate);
$('lTitle').addEventListener('input', updateTitleCount);
$('saveListing').addEventListener('click', () => patchListing({}, '保存しました'));
$('queueListing').addEventListener('click', () => patchListing({ status: 'queued' }, '出品待ちに入れました'));
$('zip').addEventListener('click', downloadZip);
$('queueStart').addEventListener('click', () => queueCommand('QUEUE_START'));
$('queueStop').addEventListener('click', () => queueCommand('QUEUE_STOP'));
$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify({ product, listing }, null, 2));
  setStatus('コピーしました');
});
$('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ product, listing }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `taobao_${product.itemId || 'item'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.queue) renderQueue(changes.queue.newValue);
  if (area === 'local' && changes.auth) loadAccount();
});
init();
