/**
 * popup.js
 * ============================================================
 * ポップアップ画面全体の動きを担当するファイル。
 *
 * 画面は3つ：
 *   view-home    … 「この商品を取り込む」ボタン＋保存済み一覧
 *   view-confirm … 取り込み内容の確認・修正・画像選択
 *   view-done    … 保存完了＋SNS投稿文
 *
 * データの保存は lib/storage.js、価格計算は lib/price.js、
 * SNS文は lib/sns.js、ファイル出力は lib/export.js に任せています。
 * ============================================================
 */

const LOG = '[MAMC取り込み]';

/** document.getElementById の短縮形 */
function $(id) {
  return document.getElementById(id);
}

// いま確認画面に表示しているデータ（スクレイプ結果）
let currentDraft = null;
// 読み込んだ設定
let currentSettings = null;
let currentSnsTemplate = null;

// ---------- 画面の切り替え ----------

function showView(name) {
  $('view-home').hidden = name !== 'home';
  $('view-confirm').hidden = name !== 'confirm';
  $('view-done').hidden = name !== 'done';
}

/** メッセージ表示（type: '' | 'error' | 'success'） */
function showMessage(elId, text, type) {
  const el = $(elId);
  el.textContent = text;
  el.className = 'message' + (type ? ' ' + type : '');
  el.hidden = !text;
}

// ---------- ホーム画面 ----------

/** 保存済み商品の一覧を描画する */
async function renderHome() {
  try {
    const products = await getProducts(); // 新しい順
    $('product-count').textContent = products.length;

    const ul = $('product-list');
    ul.textContent = '';

    if (products.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'まだ商品がありません。Taobaoの商品ページで取り込んでください。';
      ul.appendChild(li);
      return;
    }

    for (const p of products) {
      const li = document.createElement('li');

      const img = document.createElement('img');
      if (p.images && p.images.length > 0) img.src = p.images[0];
      li.appendChild(img);

      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.code + '　' + (p.title || '(名称未設定)');
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent =
        formatJpy(p.priceJpy) + '（' + (p.priceCny ?? '?') + '元）・画像' +
        (p.images ? p.images.length : 0) + '枚';
      info.appendChild(name);
      info.appendChild(sub);
      li.appendChild(info);

      const btnSns = document.createElement('button');
      btnSns.className = 'small';
      btnSns.textContent = 'SNS文コピー';
      btnSns.addEventListener('click', async () => {
        const text = buildSnsText(p, currentSnsTemplate);
        await copyToClipboard(text);
        btnSns.textContent = 'コピーしました✓';
        setTimeout(() => (btnSns.textContent = 'SNS文コピー'), 1500);
      });
      li.appendChild(btnSns);

      const btnDel = document.createElement('button');
      btnDel.className = 'small';
      btnDel.textContent = '削除';
      btnDel.addEventListener('click', async () => {
        if (confirm(p.code + ' を削除しますか？')) {
          await deleteProduct(p.code);
          await renderHome();
        }
      });
      li.appendChild(btnDel);

      ul.appendChild(li);
    }
  } catch (e) {
    console.error(LOG, '一覧の表示に失敗:', e);
    showMessage('home-message', '一覧の表示に失敗しました: ' + e.message, 'error');
  }
}

// ---------- 取り込み処理 ----------

/** いま開いているタブがTaobao/Tmallの商品ページっぽいか */
function isTaobaoUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('taobao.com') || host.endsWith('tmall.com');
  } catch (e) {
    return false;
  }
}

/** 「この商品を取り込む」ボタンの処理 */
async function importCurrentPage() {
  showMessage('home-message', '', '');
  try {
    // ① いま見ているタブを調べる（activeTab権限：ボタンを押したタブだけ）
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !isTaobaoUrl(tab.url)) {
      showMessage('home-message',
        'Taobao（またはTmall）の商品ページを開いた状態で押してください。', 'error');
      return;
    }

    showMessage('home-message', '取り込み中です…', '');

    // ② いま表示中のページ「1ページだけ」にスクリプトを注入して情報を取る
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/selectors.js', 'content/scraper.js']
    });
    const data = results && results[0] ? results[0].result : null;
    if (!data || !data.ok) {
      throw new Error('ページから情報を取得できませんでした。ページを再読み込みして試してください。');
    }
    console.log(LOG, '取得データ:', data);

    // ③ 重複チェック（同じ商品ID or 同じURL）
    const dup = await findDuplicate(data.taobaoId, data.url);
    if (dup) {
      showMessage('home-message',
        'この商品はすでに登録されています（' + dup.code + '）', 'error');
      return;
    }

    // ④ 確認画面を開く
    currentDraft = data;
    fillConfirmView(data);
    showMessage('home-message', '', '');
    showView('confirm');
  } catch (e) {
    console.error(LOG, '取り込みに失敗:', e);
    showMessage('home-message', '取り込みに失敗しました。\n' + e.message, 'error');
  }
}

// ---------- 確認画面 ----------

/** スクレイプ結果を確認画面のフォームに流し込む */
function fillConfirmView(data) {
  $('f-title').value = data.title || '';
  $('f-price-cny').value = data.priceCny ?? '';
  $('f-original-cny').value = data.originalPriceCny ?? '';
  $('f-taobao-id').value = data.taobaoId || '';
  $('f-url').value = data.url || '';
  $('f-colors').value = (data.colors || []).join(', ');
  $('f-sizes').value = (data.sizes || []).join(', ');
  showMessage('confirm-message', '', '');

  // 日本円価格を自動計算して表示
  recalcJpy();
  const s = currentSettings;
  $('price-formula-note').textContent =
    '計算式：元価格 × ' + s.exchangeRate + '円 ＋ 送料' + s.shippingJpy +
    '円 → 利益率' + s.profitRate + '% → ' + s.roundUnit + '円単位で切り上げ（⚙設定で変更できます）';

  renderImageGrid(data.images || []);
}

/** 人民元の入力値から日本円販売価格を計算し直す */
function recalcJpy() {
  const cny = parseFloat($('f-price-cny').value);
  const jpy = calculateSellingPrice(cny, currentSettings);
  $('f-price-jpy').value = jpy ?? '';
}

/** 画像一覧（チェックボックス付き）を描画する */
function renderImageGrid(images) {
  const grid = $('image-grid');
  grid.textContent = '';
  const kindLabel = { main: '商品画像', detail: '説明画像', other: 'その他' };

  images.forEach((im, i) => {
    const item = document.createElement('div');
    item.className = 'image-item selected';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.index = i;

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = im.url;
    img.title = im.url;
    // 読み込めなかった画像は自動でチェックを外して薄く表示
    img.addEventListener('error', () => {
      cb.checked = false;
      updateImageItemStyle(item, cb);
      updateImageCount();
    });

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = kindLabel[im.kind] || im.kind;

    // カード全体をクリックしてもチェックを切り替えられるように
    item.addEventListener('click', (ev) => {
      if (ev.target !== cb) cb.checked = !cb.checked;
      updateImageItemStyle(item, cb);
      updateImageCount();
    });

    item.appendChild(cb);
    item.appendChild(img);
    item.appendChild(kind);
    grid.appendChild(item);
  });

  updateImageCount();
}

function updateImageItemStyle(item, cb) {
  item.classList.toggle('selected', cb.checked);
  item.classList.toggle('deselected', !cb.checked);
}

/** 「n / m 枚選択中」の表示を更新 */
function updateImageCount() {
  const boxes = $('image-grid').querySelectorAll('input[type="checkbox"]');
  const checked = Array.from(boxes).filter((b) => b.checked).length;
  $('image-selected-count').textContent = checked;
  $('image-total-count').textContent = boxes.length;
}

/** すべて選択 / すべて解除 */
function setAllImages(checked) {
  for (const item of $('image-grid').children) {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.checked = checked;
      updateImageItemStyle(item, cb);
    }
  }
  updateImageCount();
}

/** 「,」区切りの文字列を配列にする（空要素は除く） */
function splitList(text) {
  return (text || '')
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 確認画面の内容で保存する */
async function saveFromConfirm() {
  try {
    const title = $('f-title').value.trim();
    if (!title) {
      showMessage('confirm-message', '商品名を入力してください。', 'error');
      return;
    }

    // チェックが付いている画像だけを保存する
    const selectedImages = [];
    for (const item of $('image-grid').children) {
      const cb = item.querySelector('input[type="checkbox"]');
      const img = item.querySelector('img');
      if (cb && cb.checked && img) selectedImages.push(img.src);
    }

    const priceCny = parseFloat($('f-price-cny').value);
    const originalCny = parseFloat($('f-original-cny').value);
    const priceJpy = parseFloat($('f-price-jpy').value);

    const product = {
      title,
      url: $('f-url').value.trim(),
      taobaoId: $('f-taobao-id').value.trim(),
      priceCny: isNaN(priceCny) ? null : priceCny,
      originalPriceCny: isNaN(originalCny) ? null : originalCny,
      priceJpy: isNaN(priceJpy) ? null : priceJpy,
      colors: splitList($('f-colors').value),
      sizes: splitList($('f-sizes').value),
      skuProps: currentDraft ? currentDraft.skuProps : [],
      images: selectedImages,
      scrapedAt: currentDraft ? currentDraft.scrapedAt : new Date().toISOString()
    };

    const saved = await saveProduct(product); // 管理番号が付いて返ってくる

    // 完了画面へ
    $('done-code').textContent = saved.code;
    $('done-sns-text').value = buildSnsText(saved, currentSnsTemplate);
    showMessage('done-message', '', '');
    showView('done');
    await renderHome();
  } catch (e) {
    console.error(LOG, '保存に失敗:', e);
    showMessage('confirm-message', e.message, 'error');
  }
}

// ---------- クリップボード ----------

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // 古い環境用の予備手段
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ---------- 初期化（ポップアップを開いたとき） ----------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await dbLoad();
    currentSettings = data.settings;
    currentSnsTemplate = data.snsTemplate;

    // --- ホーム画面のボタン ---
    $('btn-import').addEventListener('click', importCurrentPage);
    $('btn-open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('btn-export-json').addEventListener('click', async () => {
      const products = (await getProducts()).slice().reverse(); // 登録順に戻す
      exportJson(products);
    });
    $('btn-export-csv').addEventListener('click', async () => {
      const products = (await getProducts()).slice().reverse();
      exportCsv(products);
    });

    // --- 確認画面のボタン ---
    $('btn-select-all').addEventListener('click', () => setAllImages(true));
    $('btn-select-none').addEventListener('click', () => setAllImages(false));
    $('f-price-cny').addEventListener('input', recalcJpy);
    $('btn-save').addEventListener('click', saveFromConfirm);
    $('btn-cancel').addEventListener('click', () => {
      currentDraft = null;
      showView('home');
    });

    // --- 完了画面のボタン ---
    $('btn-copy-sns').addEventListener('click', async () => {
      await copyToClipboard($('done-sns-text').value);
      showMessage('done-message', '投稿文をコピーしました。', 'success');
    });
    $('btn-back-home').addEventListener('click', () => showView('home'));

    await renderHome();
    showView('home');
  } catch (e) {
    console.error(LOG, '初期化に失敗:', e);
    showMessage('home-message', '初期化に失敗しました: ' + e.message, 'error');
  }
});
