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
// ---- 今どうなっているか（作業中・完了・エラー）を、画面の上にはっきり出す ----
let busyNow = false;
function setStatus(text, kind) {
  const s = $('status');
  const k = kind || (busyNow ? 'busy' : 'info');
  s.className = 'status ' + k;
  s.hidden = !text;
  s.textContent = text || '';
  if (text && (k === 'done' || k === 'error')) s.scrollIntoView({ block: 'nearest' });
}
/** 作業を始める：ボタンを「○○中…」にして押せなくし、上に「作業中」を出す */
function begin(btn, busyLabel, text) {
  busyNow = true;
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.textContent = busyLabel;
  btn.disabled = true;
  setStatus(text, 'busy');
}
/** 作業が終わった：ボタンを元に戻し、上に「完了」か「エラー」をはっきり出す */
function finish(btn, ok, text) {
  busyNow = false;
  if (btn.dataset.label) btn.textContent = btn.dataset.label;
  btn.disabled = false;
  setStatus(text, ok ? 'done' : 'error');
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
    // ログインの確認が終わる前にボタンを押したときの、古いお知らせを消す
    if (accountActive && $('status').textContent === inactiveMessage) setStatus('');
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

/** BUYMA に入れる画像（正方形にしたもの）だけを並べる。元の画像（途中で切れているもの）は見せない */
const BUYMA_IMAGE_MAX = 20;
function renderImages() {
  const plan = product && product.imagePlan;
  if (!plan) {
    $('imgcount').textContent = '';
    $('images').replaceChildren();
    $('prepareImages').hidden = !(product && product.images && product.images.length);
    return;
  }
  $('prepareImages').hidden = true;
  const used = plan.filter((x) => x.keep).length;
  $('imgcount').textContent = `（使う ${Math.min(used, BUYMA_IMAGE_MAX)}枚 / BUYMA は${BUYMA_IMAGE_MAX}枚まで）`;
  let n = 0;
  $('images').replaceChildren(
    ...plan.map((item, i) => {
      const order = item.keep ? ++n : 0;
      const over = order > BUYMA_IMAGE_MAX;
      const box = el('label', { className: 'imgpick' + (item.keep && !over ? '' : ' off'), title: item.keep ? (over ? '20枚を超えるので入りません' : `${order}枚目`) : '使わない' });
      const cb = el('input', { type: 'checkbox', checked: item.keep });
      cb.setAttribute('aria-label', `${i + 1}番目の画像を使う`);
      cb.addEventListener('change', () => {
        item.keep = cb.checked;
        renderImages();
        saveState();
      });
      const ja = item.thumbJa && item.texts && item.texts.length && item.translate !== false;
      box.append(cb, el('img', { src: ja ? item.thumbJa : item.thumb, alt: '' }));
      if (item.thumbJa && item.texts && item.texts.length) {
        const t = el('button', { type: 'button', className: 'jaflag' + (item.translate === false ? ' off' : ''), title: item.translate === false ? '元の文字のまま（押すと日本語に書き換える）' : '日本語に書き換えています（押すと元の文字に戻す）' }, item.translate === false ? '原' : '訳');
        t.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          item.translate = item.translate === false;
          renderImages();
          saveState();
        });
        box.append(t);
      }
      return box;
    })
  );
}

/**
 * 画像の中の外国語（中国語など）を日本語に書き換える。
 * 文字の読み取りは拡張機能の中で行い（無料）、読み取った文字だけをサーバーで訳す（画像は送らない）。
 */
async function translateImagePlan() {
  const plan = product && product.imagePlan;
  if (!plan || !plan.length || !accountActive) return;
  let ocr = null;
  try {
    setStatus('【4/4】画像の中の文字を読み取っています…');
    ocr = await RakuImageText.createOcr(chrome.runtime.getURL(''));
    await BuymaImages.ocrPlan(plan, (c) => ocr.recognize(c), (i, n) => setStatus(`【4/4】画像の中の文字を読み取っています… ${i}/${n}`));
    // 訳す行を集める（同じ文字は1回だけ訳す）
    const lines = [];
    for (const it of plan) for (const l of it.ocr || []) if (RakuImageText.needsTranslation(l.text, l.confidence) && !lines.includes(l.text)) lines.push(l.text);
    if (!lines.length) {
      setStatus('画像の中に、書き換える外国語は見つかりませんでした');
      return;
    }
    setStatus(`【4/4】画像の中の文字（${lines.length}か所）を日本語にしています…`);
    const { ja } = await api.imageText(product.title || '', lines.slice(0, 300));
    const dict = new Map(lines.map((l, i) => [l, (ja && ja[i]) || '']));
    const changed = [];
    for (const it of plan) {
      it.texts = (it.ocr || [])
        .filter((l) => dict.get(l.text) && dict.get(l.text) !== l.text)
        .map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, ja: dict.get(l.text) }));
      if (it.texts.length) changed.push(it);
      delete it.ocr;
    }
    if (changed.length) await BuymaImages.rethumb(changed, 120);
    renderImages();
    await saveState();
    setStatus(changed.length ? `${changed.length}枚の画像の文字を日本語に書き換えました。「訳」を押すと元の文字に戻せます` : '書き換える文字はありませんでした');
  } catch (e) {
    setStatus('画像の文字を日本語にできませんでした（画像はそのまま使えます）：' + e.message);
  } finally {
    if (ocr) ocr.terminate().catch(() => {});
  }
}

/** 元の画像から、BUYMA に入れる画像の候補を作る（つなぎ直し・人ごとに分ける・正方形）。最大30枚、最初の20枚を使う */
async function prepareImagePlan() {
  if (!product || !product.images || !product.images.length) return;
  $('prepareImages').disabled = true;
  try {
    setStatus('BUYMA に入れる画像を作っています…（数秒〜20秒ほど）');
    const { items } = await BuymaImages.planImages(
      product.images,
      { descUrls: product.descImages || [], limit: 30, thumbPx: 120 },
      (i, n) => setStatus(`【3/4】BUYMA に入れる画像を作っています… ${i}/${n}`)
    );
    items.forEach((x, i) => (x.keep = i < BUYMA_IMAGE_MAX));
    product.imagePlan = items;
    renderImages();
    await saveState();
    if (settings.translateImageText && items.length) await translateImagePlan();
    setStatus(items.length ? `画像を${Math.min(items.length, BUYMA_IMAGE_MAX)}枚用意しました。違う画像はチェックを外すと、次の候補が繰り上がります` : '画像を作れませんでした');
  } catch (e) {
    setStatus('画像を作れませんでした：' + e.message);
  } finally {
    $('prepareImages').disabled = false;
  }
}

/** 画像の置き場所への許可がすでにあれば、すぐに候補を作る（なければボタンを出す） */
async function autoPrepareImages() {
  if (!product || product.imagePlan || !product.images || !product.images.length) return renderImages();
  const origins = imageOrigins(product.images);
  const ok = !origins.length || (await chrome.permissions.contains({ origins }));
  if (ok) await prepareImagePlan();
  else renderImages();
}

function imageOrigins(urls) {
  return Array.from(
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
}

/** 使う画像（チェックあり・上から20枚まで）を、本番の大きさで作る */
async function buildChosenImages(p, s, onProgress) {
  const opts = { maxPx: s.imageMaxPx, quality: s.jpegQuality, watermark: s.watermarkEnabled ? s.watermarkText : '', limit: BUYMA_IMAGE_MAX, descUrls: p.descImages || [] };
  if (Array.isArray(p.imagePlan) && p.imagePlan.length) {
    const chosen = p.imagePlan.filter((x) => x.keep).slice(0, BUYMA_IMAGE_MAX);
    return BuymaImages.renderPlan(chosen, p.itemId, opts, onProgress);
  }
  return BuymaImages.buildImageFiles(p.images, p.itemId, opts, onProgress);
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

/**
 * タオバオ・天猫：商品説明の画像は、下までスクロールしないと読み込まれないことがあるので、
 * 人が読むくらいの速さで（なめらかに、間隔も少しずつ変えて）下まで送り、最後に元の位置へ戻す。
 * 長くても約15秒で止める。ページの中身は変えず、画像の読み込みはページ自身に任せる。
 */
async function scrollToLoadImages() {
  const host = location.hostname;
  if (!/(^|\.)(taobao\.com|tmall\.com|tmall\.hk)$/.test(host)) return;
  const start = window.scrollY;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const step = Math.round(window.innerHeight * (0.55 + Math.random() * 0.25));
    window.scrollBy({ top: step, behavior: 'smooth' });
    await wait(600 + Math.random() * 500);
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 5) break;
  }
  await wait(800);
  window.scrollTo({ top: start, behavior: 'smooth' });
}

async function extract() {
  if (!requireActive()) return;
  begin($('extract'), '読み取り中…（このまま待ってください）', '読み取りを始めました（全部で20秒〜1分ほど）');
  let ok = false;
  let doneText = '';
  try {
    let read;
    try {
      if (settings.autoScroll) {
        setStatus('【1/4】商品説明の画像も読み込むため、ページをゆっくり下まで送っています…（10秒ほど）');
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollToLoadImages });
      }
      setStatus('【2/4】商品の情報を読み取っています…');
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
    setStatus('【3/4】BUYMA に入れる画像を作っています…');
    await saveState();
    await autoPrepareImages();
    ok = true;
    doneText = product.complete
      ? '✓ 読み取りが終わりました。中国語のままで大丈夫です。下の「この内容で出品データを作る」を押すと、日本語の出品データができます'
      : '✓ 読み取りが終わりました（一部の情報が取れませんでした）。直すか「スクショで補う」を使ってから、出品データを作ってください';
    loadAccount();
  } catch (e) {
    doneText = e.message;
  } finally {
    finish($('extract'), ok, doneText || '読み取れませんでした。ページを再読み込みしてから、もう一度押してください');
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
  begin($('generate'), '作っています…（10〜30秒）', '出品データを作っています…（10〜30秒ほど。このまま待ってください）');
  let ok = false;
  let doneText = '';
  try {
    // 画面に今入っている式を使い、次の商品のために覚えておく（書き換えてすぐ押しても、新しい式で計算する）
    const exprNow = $('priceExpr').value.trim();
    if ($('pmAdd').checked) {
      if (exprNow && !EXPR_CHARS.test(exprNow)) throw new Error('計算式に使えない文字があります。数字・x・＋−×÷・かっこで書いてください（例：×1.3+2000）');
      if (exprNow !== settings.priceExpr || settings.priceMode !== 'add') settings = await api.saveSettings({ priceMode: 'add', priceExpr: exprNow || settings.priceExpr });
    }
    const useExpr = settings.priceMode === 'add' && settings.priceExpr;
    const res = await api.generate(product, $('template').value, $('instruction').value.trim(), useExpr ? settings.priceExpr : undefined);
    listing = res.listing;
    renderListing(listing);
    await saveState();
    ok = true;
    doneText = '✓ 出品データができました。次は BUYMA の出品画面を開いて、拡張機能の「BUYMAに反映」を押してください';
  } catch (e) {
    doneText = e.message;
  } finally {
    finish($('generate'), ok, doneText);
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
    const { files, failed } = await buildChosenImages({ ...current, itemId }, s, (i, n) => setStatus(`画像を準備中… ${i}/${n}（このまま開いておいてください）`));
    const ok = files.length;
    const zip = BuymaZip.makeZip(files);
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
  lines.push('✓ ラク出品：入力が終わりました');
  if (r.filled.length) lines.push(r.filled.join('・') + ' を入れました。');
  if (r.skipped.length) lines.push('すでに入っていたので、そのままにした欄：' + r.skipped.join('・'));
  if (r.missing.length) lines.push('見つからなかった欄：' + r.missing.join('・') + '（ご自身で入れてください）');
  lines.push(...r.notes);
  lines.push('内容を確かめてから「入力内容を確認する」を押してください。');
  F.showBanner(document, lines, !r.filled.length);
}
function readActiveCategoryLevel(i) {
  return globalThis.RakuBuymaFill.categoryLevel(document, i);
}
function pickActiveCategory(i, index) {
  const F = globalThis.RakuBuymaFill;
  return F.categoryPick(document, i, index).then((name) => ({ name, info: F.categoryPickInfo() }));
}

/**
 * カテゴリを1段ずつ選ぶ。名前がはっきり合えばそのまま、合わなければ BUYMA の実際の候補を AI に見せて選んでもらう。
 * @returns {{chosen: string[], note: string}}
 */
async function chooseCategory(wanted, title) {
  const segs = PF.categorySegments(wanted);
  const chosen = [];
  // カテゴリの手がかりがなくても、商品名から AI に選んでもらう
  for (let i = 0; i < 4; i++) {
    const lv = await runInBuyma(readActiveCategoryLevel, [i]);
    if (!lv || !lv.exists) break;
    if (lv.selected) {
      if (i === 0) return { chosen: [], note: 'カテゴリはすでに選ばれていたので、そのままにしました。', skipped: true };
      chosen.push(lv.selected);
      continue;
    }
    if (!lv.options.length) return { chosen, note: `カテゴリの${i + 1}段目の候補が出ませんでした。ご自身で選んでください。` };
    // 「最近出品したカテゴリ」だけが出ている作り（候補が「名前（場所）」）：場所まで同じものだけを選ぶ。違うものを AI に選ばせない
    const recent = lv.options.filter((o) => /（.+>.+）$/.test(o)).length >= Math.max(1, lv.options.filter((o) => !o.startsWith('—')).length);
    if (recent) {
      const path = (o) => {
        const m = o.match(/^(.*)（(.+)）$/);
        return m ? PF.categorySegments(m[2] + ' > ' + m[1]).join('>') : '';
      };
      const want = segs.join('>');
      const hit = lv.options.findIndex((o) => path(o) && (path(o) === want || want.startsWith(path(o))));
      if (hit < 0) {
        await runInBuyma(pickActiveCategory, [i, '']);
        return { chosen, note: `カテゴリの候補が「最近出品したカテゴリ」（${lv.options.filter((o) => !o.startsWith('—')).join('・')}）だけで、この商品（${wanted || '不明'}）に合うものがなかったので選んでいません。ご自身で選んでください。` };
      }
      const picked = (await runInBuyma(pickActiveCategory, [i, lv.options[hit]])) || {};
      if (!picked.name) return { chosen, note: `カテゴリを選べませんでした。ご自身で選んでください。（くわしく：${picked.info || '理由不明'}・版 ${chrome.runtime.getManifest().version}）` };
      chosen.push(picked.name);
      continue;
    }
    let index = segs[i] ? PF.localCategoryPick(lv.options, segs[i]) : -1;
    if (index < 0) {
      setStatus(`カテゴリの${i + 1}段目を選んでいます…`);
      try {
        index = (await api.pickCategory({ title: title || '', wanted: wanted || title || '（不明）', chosen, options: lv.options.slice(0, 300) })).index;
      } catch (e) {
        index = -1;
      }
    }
    if (index < 0) {
      await runInBuyma(pickActiveCategory, [i, '']);
      return { chosen, note: `カテゴリの${i + 1}段目は、合う候補がはっきりしなかったので選んでいません。ご自身で選んでください。` };
    }
    const picked = (await runInBuyma(pickActiveCategory, [i, lv.options[index]])) || {};
    const name = picked.name;
    if (!name) return { chosen, note: `カテゴリの${i + 1}段目を選べませんでした。ご自身で選んでください。` + `（くわしく：${picked.info || '理由不明'}・版 ${chrome.runtime.getManifest().version}）` };
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
  // 配送方法：いくつでも選べる。選んだものは覚えて、次の商品からも使う
  const box = $('buymaShipping');
  const list = settings.shippingMethods;
  if (!list.length) {
    box.replaceChildren(el('p', { className: 'small muted' }, '（この画面に配送方法の一覧がありません）'));
    return;
  }
  box.replaceChildren(
    ...list.map((n) => {
      const cb = el('input', { type: 'checkbox', checked: settings.shippingChosen.includes(n) });
      cb.addEventListener('change', async () => {
        const chosen = Array.from(box.querySelectorAll('input[type=checkbox]'))
          .map((c, k) => (c.checked ? list[k] : null))
          .filter(Boolean);
        settings = await api.saveSettings({ shippingChosen: chosen, lastShipping: chosen[0] || '' });
        setStatus(chosen.length ? `配送方法を${chosen.length}件覚えました。次の商品からも自動で使います` : '配送方法を未選択にしました');
      });
      const lab = el('label', { className: 'small shipopt' });
      lab.append(cb, document.createTextNode(' ' + n));
      return lab;
    })
  );
}

async function showBuymaBox() {
  const { lastForBuyma } = await chrome.storage.local.get('lastForBuyma');
  $('buymaBox').hidden = false;
  $('extract').hidden = true;
  await setupBuymaShipping();
  if (!lastForBuyma || !lastForBuyma.listing) {
    $('buymaTarget').textContent = 'まだ出品データがありません。先に仕入れ先の商品ページで「この商品の情報を取る」→「この内容で出品データを作る」をしてください。';
    $('buymaTarget').className = 'small notready';
    $('fillBuyma').disabled = true;
    return;
  }
  $('buymaTarget').textContent = `✓ 準備OK：「${lastForBuyma.listing.title || '（商品名なし）'}」をこの画面に入れられます。下の赤い「BUYMAに反映」を押してください`;
  $('buymaTarget').className = 'small ready';
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
  values.shippingList = settings.shippingChosen.length ? settings.shippingChosen : [];
  values.shipping = settings.shippingChosen[0] || values.shipping || settings.lastShipping || '';
  values.noBrandIfUnknown = settings.noBrandIfUnknown;
  values.categoryByPopup = true;
  begin($('fillBuyma'), 'BUYMA に入力中…（触らずに待ってください）', '【1/3】カテゴリを選んでいます…');
  let ok = false;
  let doneText = '';
  try {
    // カテゴリを先に選ぶ（AI と相談しながら1段ずつ）
    const cat = await chooseCategory(values.category, values.title);
    if (withImages) {
      const s = await api.getSettings();
      const p = PF.ensureItemId(lastForBuyma.product, BuymaPageReader.shortHash);
      const { files } = await buildChosenImages(p, s, (i, n) => setStatus(`【2/3】画像を準備しています… ${i}/${n}（このまま開いておいてください）`));
      values.images = files.map((f) => ({ name: f.name, type: 'image/jpeg', base64: BuymaImages.bytesToBase64(f.data) }));
    }
    setStatus('【3/3】BUYMA の画面に入れています…（色・サイズ・ブランドなど）');
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
    ok = true;
    doneText =
      '✓ BUYMA への入力が終わりました。' +
      (parts.join('。') || '入れる項目がありませんでした') +
      '。BUYMA の画面で内容を確かめて（自分で選ぶ欄は右上のお知らせに出ています）、「入力内容を確認する」を押してください';
  } catch (e) {
    doneText = 'BUYMA の画面に入れられませんでした。ページを再読み込みしてから、もう一度お試しください。';
  } finally {
    finish($('fillBuyma'), ok, doneText);
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
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  $('fCurrency').replaceChildren(...PF.CURRENCIES.map((c) => el('option', { value: c }, c)));
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  settings = await api.getSettings();
  if (tab && PF.isBuymaUrl(tab.url)) await showBuymaBox();
  await loadState();
  renderPriceMode();
  if (product) {
    renderForm(product);
    autoPrepareImages();
  }
  if (listing) renderListing(listing);
  loadAccount();
}

$('extract').addEventListener('click', extract);
$('fillBuyma').addEventListener('click', fillBuyma);
$('importShipping').addEventListener('click', importShipping);
$('inspectVariation').addEventListener('click', saveVariationInfo);
// 販売価格の決め方（設定の計算式／表示価格＋○円）。選んだもの・入れた金額は覚えて、次の商品でも使う
function renderPriceMode() {
  $('pmFormula').checked = settings.priceMode !== 'add';
  $('pmAdd').checked = settings.priceMode === 'add';
  $('priceExpr').value = settings.priceExpr || '';
}
/** 式に使える文字か（くわしい確かめはサーバーで行い、おかしければ出品データの画面でお知らせする） */
const EXPR_CHARS = /^[0-9０-９.,，．+\-*/×÷＋－−ー()（）xXｘＸ✕表示価格円\s]+$/;
async function savePriceMode(mode) {
  const raw = $('priceExpr').value.trim();
  if (mode === 'add' && raw && !EXPR_CHARS.test(raw)) {
    setStatus('計算式に使えない文字があります。数字・x・＋−×÷・かっこで書いてください（例：×1.3+2000）');
    return;
  }
  const patch = { priceMode: mode, priceExpr: raw };
  if (mode === 'add' && !raw) patch.priceExpr = '+3000'; // はじめて選んだときの式
  settings = await api.saveSettings(patch);
  renderPriceMode();
  setStatus(
    settings.priceMode === 'add'
      ? `販売価格は「表示価格（円）${settings.priceExpr}」の計算式で決めます。次の商品からも同じです`
      : '販売価格は、管理画面の「設定」の計算式で計算します。次の商品からも同じです'
  );
}
$('pmFormula').addEventListener('change', () => savePriceMode('formula'));
$('pmAdd').addEventListener('change', () => savePriceMode('add'));
$('priceExpr').addEventListener('change', () => savePriceMode('add'));
$('vision').addEventListener('click', fillFromScreenshot);
$('generate').addEventListener('click', generate);
for (const id of ['fTitle', 'fPriceMin', 'fPriceMax', 'fCurrency', 'fColors', 'fSizes', 'fSpecs']) {
  $(id).addEventListener('change', saveState);
}
$('copyAll').addEventListener('click', () => copyText(PF.listingText(readListingFields()), '全部の項目'));
$('saveListing').addEventListener('click', () => patchListing({}, '保存しました'));
$('markListed').addEventListener('click', () => patchListing({ status: 'listed' }, '出品済みにしました'));
$('zip').addEventListener('click', downloadZip);
$('prepareImages').addEventListener('click', () => {
  if (!product) return;
  askImageAccess(product.images).then((granted) => (granted ? prepareImagePlan() : setStatus('画像の場所への許可がないため、画像を作れませんでした')));
});
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
