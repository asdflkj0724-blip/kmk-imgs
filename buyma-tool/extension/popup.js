const $ = (id) => document.getElementById(id);
const api = BuymaApi.createApi();
const PF = BuymaProductForm;
let TITLE_MAX = 60; // サーバー（/api/me の titleMax）から上書きする

let product = null; // 確認・修正した商品データ
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
    if (product) product = PF.productFromForm(readForm(), product);
    if (listing) Object.assign(listing, readListingFields());
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

// ---- 1. 読み取った内容の確認・修正 ----
let formImages = [];

function renderForm(p) {
  $('confirm').hidden = false;
  $('tools').hidden = false;
  const f = PF.formFromProduct(p);
  $('fTitle').value = f.title;
  $('fPriceMin').value = f.priceMin;
  $('fPriceMax').value = f.priceMax;
  $('fCurrency').value = f.currency;
  $('fColors').value = f.colors;
  $('fSizes').value = f.sizes;
  $('fSpecs').value = f.specs;
  formImages = f.images;
  renderImages();
  $('warnings').replaceChildren(...(p.warnings || []).map((w) => el('li', null, w)));
  $('vision').hidden = !!p.complete;
}

function renderImages() {
  $('imgcount').textContent = `（${formImages.filter((i) => i.keep).length} / ${formImages.length}枚）`;
  $('images').replaceChildren(
    ...formImages.map((img, i) => {
      const box = el('label', { className: 'imgpick' + (img.keep ? '' : ' off'), title: img.url });
      const cb = el('input', { type: 'checkbox', checked: img.keep });
      cb.setAttribute('aria-label', `${i + 1}枚目を使う`);
      cb.addEventListener('change', () => {
        img.keep = cb.checked;
        renderImages();
        saveState();
      });
      box.append(cb, el('img', { src: img.url, referrerPolicy: 'no-referrer', alt: '' }));
      return box;
    })
  );
}

function readForm() {
  return {
    title: $('fTitle').value,
    priceMin: $('fPriceMin').value,
    priceMax: $('fPriceMax').value,
    currency: $('fCurrency').value,
    colors: $('fColors').value,
    sizes: $('fSizes').value,
    specs: $('fSpecs').value,
    images: formImages,
  };
}

// ---- 2. BUYMA に貼る内容（項目ごとにコピー） ----
const FIELDS = [
  { key: 'title', label: 'タイトル', type: 'input' },
  { key: 'description', label: '商品コメント', type: 'textarea' },
  { key: 'priceJpy', label: '価格（円）', type: 'number' },
  { key: 'category', label: 'カテゴリー候補', type: 'input' },
  { key: 'brand', label: 'ブランド', type: 'input' },
  { key: 'colors', label: '色', type: 'input' },
  { key: 'sizes', label: 'サイズ', type: 'input' },
  { key: 'material', label: '素材', type: 'input' },
  { key: 'shippingMethod', label: '配送方法', type: 'input' },
];

const BREAKDOWN_LABELS = [
  ['productJpy', '仕入れ値（円換算）'],
  ['agentFeeJpy', '代行手数料'],
  ['domesticShippingJpy', '現地の送料'],
  ['dutyJpy', '関税など'],
  ['internationalShippingJpy', '国際送料'],
  ['otherCostJpy', 'その他'],
  ['totalCostJpy', '費用の合計'],
  ['buymaFeeJpy', 'BUYMA手数料'],
  ['profitJpy', '利益'],
];

function fieldValue(l, key) {
  const v = l[key];
  if (Array.isArray(v)) return v.join(' / ');
  return v == null ? '' : String(v);
}

function updateTitleCount() {
  const input = $('l-title');
  if (!input) return;
  const n = Array.from(input.value).length;
  $('titleCount').textContent = `${n} / ${TITLE_MAX}文字`;
  $('titleCount').className = 'small' + (n > TITLE_MAX ? ' over' : '');
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${label}をコピーしました`);
  } catch (e) {
    setStatus('コピーできませんでした');
  }
}

function renderListing(l) {
  $('listing').hidden = false;
  $('fields').replaceChildren(
    ...FIELDS.map((f) => {
      const id = 'l-' + f.key;
      const wrap = el('div', { className: 'field' });
      const head = el('div', { className: 'field-head' });
      const label = el('label', { htmlFor: id }, f.label);
      if (f.key === 'title') label.append(' ', el('span', { id: 'titleCount', className: 'small' }));
      const btn = el('button', { type: 'button', className: 'copy' }, 'コピー');
      btn.addEventListener('click', () => copyText($(id).value, f.label));
      head.append(label, btn);
      const input =
        f.type === 'textarea'
          ? el('textarea', { id, rows: 8 })
          : el('input', { id, type: f.type === 'number' ? 'number' : 'text' });
      if (f.type === 'number') input.min = '1';
      input.value = fieldValue(l, f.key);
      if (f.key === 'title') input.addEventListener('input', updateTitleCount);
      input.addEventListener('change', saveState);
      wrap.append(head, input);
      return wrap;
    })
  );
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
    fx.append(el('td', null, '為替（上乗せ後）'), el('td', null, `1 = ${b.effectiveFxRate}円`));
    rows.push(fx);
    $('breakdown').replaceChildren(...rows);
  }
  const items = [
    ...(l.priceError ? [el('li', { className: 'lv-warning' }, '【価格】' + l.priceError)] : []),
    ...(l.issues || []).map((i) => el('li', { className: 'lv-' + i.level }, (i.level === 'error' ? '【要修正】' : '【注意】') + i.message)),
    ...(l.cautions || []).map((c) => el('li', { className: 'lv-warning' }, '【確認してください】' + c)),
  ];
  $('issues').replaceChildren(...items);
}

function readListingFields() {
  const out = {};
  for (const f of FIELDS) {
    const input = $('l-' + f.key);
    if (input) out[f.key] = input.value;
  }
  return out;
}

function listingEdits() {
  const v = readListingFields();
  const price = Number(v.priceJpy);
  return {
    title: (v.title || '').trim(),
    description: v.description || '',
    priceJpy: Number.isFinite(price) && price > 0 ? Math.round(price) : undefined,
  };
}

// ---- 読み取り（どのサイトでも） ----
// ページの中で動く関数（chrome.scripting で差し込む。外の変数は使えない）
function readActivePage() {
  const host = location.hostname;
  const isTaobao = /(^|\.)(taobao\.com|tmall\.com|tmall\.hk)$/.test(host);
  return {
    url: location.href,
    siteProduct: isTaobao ? globalThis.BuymaExtractor.extractProduct(document, location.href) : null,
    page: globalThis.BuymaPageReader.readPage(document, location.href),
  };
}

async function extract() {
  if (!requireActive()) return;
  setStatus('読み取り中…');
  $('extract').disabled = true;
  try {
    let read;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/extractor.js', 'src/page-reader.js'] });
      [{ result: read }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readActivePage });
    } catch (e) {
      throw new Error('このページでは読み取れませんでした。通販サイトの商品ページを開いてから、もう一度押してください。');
    }
    let chosen;
    if (read.siteProduct && read.siteProduct.complete) {
      chosen = read.siteProduct; // タオバオ・天猫で全部取れた：AI を使わない
    } else {
      setStatus('ページから商品情報を探しています…（10〜20秒ほど）');
      const { product: fromAi } = await api.extract(read.page);
      chosen = PF.chooseProduct(read.siteProduct, fromAi);
    }
    if (!chosen) throw new Error('商品情報が見つかりませんでした。「スクショで補う」を試してください');
    if (!chosen.url) chosen.url = read.url;
    product = PF.ensureItemId(chosen, BuymaPageReader.shortHash);
    listing = null;
    $('listing').hidden = true;
    renderForm(product);
    setStatus(product.complete ? '読み取りました。内容を確認してください' : '一部の情報が取れませんでした。直すか、「スクショで補う」を試せます');
    await saveState();
    loadAccount();
  } catch (e) {
    setStatus(e.message);
  } finally {
    $('extract').disabled = false;
  }
}

async function fillFromScreenshot() {
  if (!requireActive()) return;
  setStatus('スクリーンショットを読み取り中…（10〜30秒ほど）');
  $('vision').disabled = true;
  try {
    const current = PF.productFromForm(readForm(), product);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const { product: v } = await api.vision(base64, 'image/jpeg', tab.url);
    // 足りない項目だけ補う。画像は読み取ったものを使う
    if (!current.title && v.title) current.title = v.title;
    if (!current.price && v.price) current.price = v.price;
    if (!current.skus.length && v.skus && v.skus.length) current.skus = v.skus;
    if (!current.specs.length && v.specs && v.specs.length) current.specs = v.specs;
    current.complete = !!(current.title && current.price && current.images.length);
    product = current;
    renderForm(product);
    await saveState();
    setStatus('スクリーンショットから補いました。内容を確認してください');
    loadAccount();
  } catch (e) {
    setStatus(e.message || 'スクリーンショットを読み取れませんでした');
  } finally {
    $('vision').disabled = false;
  }
}

async function generate() {
  if (!requireActive()) return;
  product = PF.ensureItemId(PF.productFromForm(readForm(), product), BuymaPageReader.shortHash);
  if (!product.title) return setStatus('商品名を入れてください');
  setStatus('出品データを作っています…（10〜30秒ほど）');
  $('generate').disabled = true;
  try {
    const res = await api.generate(product, $('template').value, $('instruction').value.trim());
    listing = res.listing;
    renderListing(listing);
    await saveState();
    setStatus('できました。項目ごとにコピーして、BUYMAの出品画面に貼ってください');
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
    Object.assign(listing, readListingFields(), { priceJpy: edits.priceJpy ?? listing.priceJpy });
    await saveState();
    setStatus(doneText);
  } catch (e) {
    setStatus(e.message);
  }
}

// ---- 画像ZIP（どのサイトでも） ----
const FIXED_IMAGE_HOSTS = /(^|\.)(alicdn\.com|taobaocdn\.com|tbcdn\.cn)$/;

function downloadZip() {
  if (!requireActive()) return;
  const current = product ? PF.productFromForm(readForm(), product) : null;
  if (!current || !current.images.length) return setStatus('画像がありません');
  // 画像の置き場所はサイトごとに違うので、そのつど許可をもらう（ボタンを押した直後に聞く必要がある）
  const origins = Array.from(
    new Set(
      current.images
        .map((u) => {
          try {
            return new URL(u);
          } catch (e) {
            return null;
          }
        })
        .filter((u) => u && !FIXED_IMAGE_HOSTS.test(u.hostname))
        .map((u) => u.origin + '/*')
    )
  );
  const ask = origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
  ask
    .then((granted) => {
      if (!granted) {
        setStatus('画像を取るための許可がなかったので、ZIPを作れませんでした。もう一度押して「許可」を選んでください。');
        return;
      }
      return buildZip(current);
    })
    .catch((e) => setStatus('ZIPを作れませんでした：' + e.message));
}

async function buildZip(current) {
  const s = await api.getSettings();
  const itemId = PF.ensureItemId(current, BuymaPageReader.shortHash).itemId;
  $('zip').disabled = true;
  try {
    const { zip, ok, failed } = await BuymaImages.buildImagesZip(
      current.images,
      itemId,
      { maxPx: s.imageMaxPx, quality: s.jpegQuality },
      (i, n) => setStatus(`画像を準備中… ${i}/${n}（このまま開いておいてください）`)
    );
    if (!ok) return setStatus('画像を1枚も取れませんでした');
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    await chrome.downloads.download({ url, filename: `taobao_${itemId}_images.zip` });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(`${ok}枚をZIPにしました` + (failed.length ? `（${failed.join('・')}枚目は取れませんでした）` : ''));
  } finally {
    $('zip').disabled = false;
  }
}

// ---- はじめに ----
async function init() {
  $('fCurrency').replaceChildren(...PF.CURRENCIES.map((c) => el('option', { value: c }, c)));
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadState();
  if (product) renderForm(product);
  if (listing) renderListing(listing);
  loadAccount();
}

$('extract').addEventListener('click', extract);
$('vision').addEventListener('click', fillFromScreenshot);
$('generate').addEventListener('click', generate);
for (const id of ['fTitle', 'fPriceMin', 'fPriceMax', 'fCurrency', 'fColors', 'fSizes', 'fSpecs']) {
  $(id).addEventListener('change', saveState);
}
$('copyAll').addEventListener('click', () => copyText(PF.listingText(readListingFields()), '全部の項目'));
$('saveListing').addEventListener('click', () => patchListing({}, '保存しました'));
$('markListed').addEventListener('click', () => patchListing({ status: 'listed' }, '出品済みにしました'));
$('zip').addEventListener('click', downloadZip);
$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
$('copy').addEventListener('click', () => copyText(JSON.stringify({ product, listing }, null, 2), 'JSON'));
$('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ product, listing }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `taobao_${(product && product.itemId) || 'item'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.auth) loadAccount();
});
init();
