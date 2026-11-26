const $ = (id) => document.getElementById(id);
const api = BuymaApi.createApi();
const PF = BuymaProductForm;
let TITLE_MAX = 60; // サーバー（/api/me の titleMax）から上書きする

let product = null; // 確認・修正した商品データ
let listing = null; // サーバーで作った出品データ
let tab = null;
let settings = null; // 拡張機能の設定（配送方法・透かしなど）

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
    // BUYMA の出品画面（別のタブ）で「BUYMAに反映」に使うため、最後に作った出品データを残す
    if (listing) await chrome.storage.local.set({ lastForBuyma: { listing, product, savedAt: Date.now() } });
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
  { key: 'shippingMethod', label: '配送方法', type: 'shipping' },
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
  const n = PF.buymaLength(input.value);
  $('titleCount').textContent = `半角換算 ${n} / ${TITLE_MAX}文字（全角は2文字）`;
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
      if (f.type === 'shipping') {
        wrap.append(head, ...shippingControl(id, fieldValue(l, f.key)));
        return wrap;
      }
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
  $('issues').replaceChildren(...PF.noticeItems(l).map((n) => el('li', { className: 'lv-' + n.level }, n.text)));
}

/** 配送方法：設定で登録した名前から選ぶ。最後に選んだものを、変えるまで次の商品にも引き継ぐ */
function shippingControl(id, serverValue) {
  const list = (settings && settings.shippingMethods) || [];
  if (!list.length) {
    const input = el('input', { id, type: 'text' });
    input.value = serverValue;
    const hint = el('p', { className: 'ship-hint' }, '設定画面で BUYMA の配送方法を登録すると、ここで選べて、次の商品にも引き継げます。');
    return [input, hint];
  }
  const select = el('select', { id });
  select.append(el('option', { value: '' }, '（選んでください）'), ...list.map((name) => el('option', { value: name }, name)));
  select.value = PF.pickShipping(list, settings.lastShipping, serverValue);
  select.addEventListener('change', async () => {
    settings = await api.saveSettings({ lastShipping: select.value });
    saveState();
    setStatus(select.value ? `配送方法「${select.value}」を次の商品にも使います` : '配送方法を未選択にしました');
  });
  return [select];
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
    const res = await api.generate(product, $('template').value, $('instruction').value.trim(), settings.addJpy == null ? undefined : settings.addJpy);
    listing = res.listing;
    renderListing(listing);
    await saveState();
    setStatus('できました。BUYMA の出品画面を開いて、もう一度このボタンから「BUYMAに反映」を押すと入ります');
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
      { maxPx: s.imageMaxPx, quality: s.jpegQuality, watermark: s.watermarkEnabled ? s.watermarkText : '' },
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

// ---- BUYMA に反映 ----
// ページの中で動く関数（外の変数は使えない）
function fillActiveBuymaPage(values) {
  return globalThis.RakuBuymaFill.fillBuymaAll(document, values);
}
function readActiveBuymaShipping() {
  return globalThis.RakuBuymaFill.readShippingOptions(document);
}
function showActiveReport(r) {
  const F = globalThis.RakuBuymaFill;
  const lines = [];
  if (r.filled.length) lines.push('ラク出品：' + r.filled.join('・') + ' を入れました。');
  if (r.skipped.length) lines.push('すでに入っていたので、そのままにした欄：' + r.skipped.join('・'));
  if (r.missing.length) lines.push('見つからなかった欄：' + r.missing.join('・') + '（ご自身で入れてください）');
  lines.push(...r.notes);
  lines.push('色とサイズの表は、ご自身で選んでください。内容を確かめてから「入力内容を確認する」を押してください。');
  F.showBanner(document, lines, !r.filled.length);
}
function readActiveCategoryLevel(i) {
  return globalThis.RakuBuymaFill.categoryLevel(document, i);
}
function pickActiveCategory(i, index) {
  return globalThis.RakuBuymaFill.categoryPick(document, i, index);
}

/**
 * カテゴリを1段ずつ選ぶ。名前がはっきり合えばそのまま、合わなければ BUYMA の実際の候補を AI に見せて選んでもらう。
 * @returns {{chosen: string[], note: string}}
 */
async function chooseCategory(wanted, title) {
  const segs = PF.categorySegments(wanted);
  const chosen = [];
  if (!segs.length) return { chosen, note: '' };
  for (let i = 0; i < 4; i++) {
    const lv = await runInBuyma(readActiveCategoryLevel, [i]);
    if (!lv || !lv.exists) break;
    if (lv.selected) {
      if (i === 0) return { chosen: [], note: 'カテゴリはすでに選ばれていたので、そのままにしました。', skipped: true };
      chosen.push(lv.selected);
      continue;
    }
    if (!lv.options.length) return { chosen, note: `カテゴリの${i + 1}段目の候補が出ませんでした。ご自身で選んでください。` };
    let index = segs[i] ? PF.localCategoryPick(lv.options, segs[i]) : -1;
    if (index < 0) {
      setStatus(`カテゴリの${i + 1}段目を選んでいます…`);
      try {
        index = (await api.pickCategory({ title: title || '', wanted, chosen, options: lv.options.slice(0, 300) })).index;
      } catch (e) {
        index = -1;
      }
    }
    if (index < 0) {
      await runInBuyma(pickActiveCategory, [i, -1]);
      return { chosen, note: `カテゴリの${i + 1}段目は、合う候補がはっきりしなかったので選んでいません。ご自身で選んでください。` };
    }
    const name = await runInBuyma(pickActiveCategory, [i, index]);
    if (!name) return { chosen, note: `カテゴリの${i + 1}段目を選べませんでした。ご自身で選んでください。` };
    chosen.push(name);
  }
  return { chosen, note: '' };
}

async function runInBuyma(func, args) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/buyma-fill.js'] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args: args || [] });
  return res && res.result;
}

/** 画像の置き場所への許可（ボタンを押した直後に聞く必要がある） */
function askImageAccess(urls) {
  const origins = Array.from(
    new Set(
      (urls || [])
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
  return origins.length ? chrome.permissions.request({ origins }) : Promise.resolve(true);
}

/** BUYMA の画面で使う配送方法の選択。一覧が空なら、この画面から自動で取り込む */
async function setupBuymaShipping() {
  if (!settings.shippingMethods.length) {
    try {
      const found = await runInBuyma(readActiveBuymaShipping);
      if (found && found.length) settings = await api.saveSettings({ shippingMethods: found });
    } catch (e) {}
  }
  const sel = $('buymaShipping');
  const list = settings.shippingMethods;
  sel.replaceChildren(el('option', { value: '' }, list.length ? '（選んでください）' : '（この画面に配送方法の一覧がありません）'), ...list.map((n) => el('option', { value: n }, n)));
  sel.value = settings.lastShipping || '';
  sel.onchange = async () => {
    settings = await api.saveSettings({ lastShipping: sel.value });
    setStatus(sel.value ? '配送方法を覚えました。次の商品からも自動で使います' : '配送方法を未選択にしました');
  };
}

async function showBuymaBox() {
  const { lastForBuyma } = await chrome.storage.local.get('lastForBuyma');
  $('buymaBox').hidden = false;
  $('extract').hidden = true;
  await setupBuymaShipping();
  if (!lastForBuyma || !lastForBuyma.listing) {
    $('buymaTarget').textContent = 'まだ出品データがありません。先に仕入れ先の商品ページで「この商品の情報を取る」→「出品データを作る」をしてください。';
    $('fillBuyma').disabled = true;
    return;
  }
  $('buymaTarget').textContent = '入れる出品データ：' + (lastForBuyma.listing.title || '（商品名なし）');
}

function fillBuyma() {
  if (!requireActive()) return;
  const withImages = $('fillImages').checked;
  // 許可の確認はボタンを押した直後にする必要があるので、先に出品データを読んでから聞く
  chrome.storage.local.get('lastForBuyma').then(({ lastForBuyma }) => {
    if (!lastForBuyma) return setStatus('まだ出品データがありません');
    const urls = (lastForBuyma.product && lastForBuyma.product.images) || [];
    const ask = withImages && urls.length ? askImageAccess(urls) : Promise.resolve(true);
    ask.then((granted) => doFillBuyma(lastForBuyma, withImages && granted, withImages && !granted));
  });
}

async function doFillBuyma(lastForBuyma, withImages, imagesDenied) {
  const values = PF.buymaValues(lastForBuyma.listing, lastForBuyma.product);
  // 配送方法：この画面で選んだもの（＝最後に選んだもの）を使う
  values.shipping = $('buymaShipping').value || values.shipping || settings.lastShipping || '';
  values.noBrandIfUnknown = settings.noBrandIfUnknown;
  values.categoryByPopup = true;
  $('fillBuyma').disabled = true;
  try {
    // カテゴリを先に選ぶ（AI と相談しながら1段ずつ）
    const cat = await chooseCategory(values.category, values.title);
    if (withImages) {
      const s = await api.getSettings();
      const p = PF.ensureItemId(lastForBuyma.product, BuymaPageReader.shortHash);
      const { files } = await BuymaImages.buildImageFiles(
        p.images,
        p.itemId,
        { maxPx: s.imageMaxPx, quality: s.jpegQuality, watermark: s.watermarkEnabled ? s.watermarkText : '', limit: 20 },
        (i, n) => setStatus(`画像を準備中… ${i}/${n}（このまま開いておいてください）`)
      );
      values.images = files.map((f) => ({ name: f.name, type: 'image/jpeg', base64: BuymaImages.bytesToBase64(f.data) }));
    }
    setStatus('BUYMA の画面に入れています…');
    const r = await runInBuyma(fillActiveBuymaPage, [values]);
    if (!r) throw new Error('結果が返ってきませんでした');
    if (cat.chosen.length && !cat.skipped) r.filled.unshift('カテゴリ（' + cat.chosen.join(' > ') + '）');
    if (cat.skipped) r.skipped.unshift('カテゴリ');
    if (cat.note) r.notes.unshift(cat.note);
    await runInBuyma(showActiveReport, [r]);
    const parts = [];
    if (r.filled.length) parts.push(`${r.filled.join('・')} を入れました`);
    if (r.skipped.length) parts.push(`${r.skipped.join('・')} はすでに入っていたので、そのままにしました`);
    if (r.missing.length) parts.push(`${r.missing.join('・')} は見つかりませんでした`);
    if (imagesDenied) parts.push('画像は、許可がなかったので入れていません');
    setStatus((parts.join('。') || '入れる項目がありませんでした') + '。くわしくは BUYMA の画面の右上をご覧ください');
  } catch (e) {
    setStatus('BUYMA の画面に入れられませんでした。ページを再読み込みしてから、もう一度お試しください。');
  } finally {
    $('fillBuyma').disabled = false;
  }
}

/** BUYMA の出品画面の、登録済みの配送方法を、名前そのままで設定に取り込む */
async function importShipping() {
  try {
    const found = await runInBuyma(readActiveBuymaShipping);
    if (!found || !found.length) return setStatus('この画面に配送方法の一覧が見つかりませんでした（出品画面で押してください）');
    const s = await api.getSettings();
    const merged = s.shippingMethods.concat(found.filter((n) => !s.shippingMethods.includes(n)));
    settings = await api.saveSettings({ shippingMethods: merged });
    setStatus(`配送方法を${found.length}件取り込みました。出品データの画面で選べます`);
  } catch (e) {
    setStatus('配送方法を取り込めませんでした。ページを再読み込みしてから、もう一度お試しください。');
  }
}

/** 色・サイズ欄の作りを調べて、ファイルに保存する（色・サイズの自動入力を作るための下調べ） */
function inspectActiveVariation() {
  return globalThis.RakuBuymaFill.inspectVariation(document);
}
async function saveVariationInfo() {
  $('inspectVariation').disabled = true;
  try {
    setStatus('色・サイズ欄を調べています…（画面のタブが切り替わりますが、何も変えません）');
    const info = await runInBuyma(inspectActiveVariation);
    if (!info || !info.found) return setStatus('この画面に「色・サイズ」欄が見つかりませんでした（出品画面で押してください）');
    const blob = new Blob([JSON.stringify(info, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: 'buyma-color-size.json' });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus('保存しました。「ダウンロード」フォルダの buyma-color-size.json をチャットに送ってください');
  } catch (e) {
    setStatus('調べられませんでした。ページを再読み込みしてから、もう一度お試しください。');
  } finally {
    $('inspectVariation').disabled = false;
  }
}

// ---- はじめに ----
async function init() {
  $('fCurrency').replaceChildren(...PF.CURRENCIES.map((c) => el('option', { value: c }, c)));
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  settings = await api.getSettings();
  if (tab && PF.isBuymaUrl(tab.url)) await showBuymaBox();
  await loadState();
  $('addJpy').value = settings.addJpy == null ? '' : String(settings.addJpy);
  if (product) renderForm(product);
  if (listing) renderListing(listing);
  loadAccount();
}

$('extract').addEventListener('click', extract);
$('fillBuyma').addEventListener('click', fillBuyma);
$('importShipping').addEventListener('click', importShipping);
$('inspectVariation').addEventListener('click', saveVariationInfo);
// 「＋○円」は入れた時点で覚え、次の商品でもそのまま使う
$('addJpy').addEventListener('change', async () => {
  const raw = $('addJpy').value.trim();
  settings = await api.saveSettings({ addJpy: raw === '' ? null : raw });
  $('addJpy').value = settings.addJpy == null ? '' : String(settings.addJpy);
  setStatus(settings.addJpy == null ? '「＋○円」を空にしました。管理画面の設定の計算方法で決めます' : `販売価格は「仕入れ先の値段（円）＋${settings.addJpy.toLocaleString()}円」で計算します。次の商品からも同じです`);
});
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
  if (area === 'local' && changes.settings) api.getSettings().then((s) => (settings = s));
});
init();
