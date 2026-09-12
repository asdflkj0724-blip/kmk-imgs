/**
 * popup.js
 * ============================================================
 * ポップアップ画面の動きを担当します。
 *
 * 画面は4つ:
 *   1. ホーム画面    … 「この商品を取り込む」ボタン
 *   2. 確認画面      … 取得内容の確認・修正・画像選択
 *   3. 保存完了画面  … 管理番号とSNS投稿文の表示
 *   4. 一覧画面      … 保存済み商品 / JSON・CSV出力
 *
 * 取り込み処理そのものは content/extractor.js が行い、
 * 結果をメッセージで受け取ります。
 * ============================================================
 */

'use strict';

var LOG_PREFIX = '[MAMCポップアップ]';

/** いま確認画面に出している下書きデータ */
var currentDraft = null;

/** 保存直後の商品(完了画面用) */
var lastSavedProduct = null;

// ------------------------------------------------------------
// 便利関数
// ------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, [LOG_PREFIX].concat(args));
}

/** 4つの画面のうち1つだけを表示する */
function showView(viewId) {
  ['view-home', 'view-confirm', 'view-done', 'view-list'].forEach(function (id) {
    $(id).hidden = (id !== viewId);
  });
}

/** 上部の状態メッセージを表示する(type: info / success / error) */
function setStatus(message, type) {
  var el = $('status');
  if (!message) {
    el.hidden = true;
    return;
  }
  el.textContent = message;
  el.className = 'status ' + (type || 'info');
  el.hidden = false;
}

/** アクティブなタブを取得 */
async function getActiveTab() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/** URLがTaobao/Tmallの商品ページらしいか */
function looksLikeProductPage(url) {
  if (!url) return false;
  var isTaobao = url.indexOf('taobao.com') !== -1 || url.indexOf('tmall.com') !== -1;
  var hasItem = url.indexOf('item') !== -1 || url.indexOf('id=') !== -1;
  return isTaobao && hasItem;
}

/** 「黒、白, 赤」のような文字列を配列にする */
function splitList(text) {
  return String(text || '')
    .split(/[、,，\/]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

// ------------------------------------------------------------
// 起動時
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async function () {
  try {
    bindEvents();
    await updatePageInfo();

    // ポップアップが閉じても途中データを復元できるようにしている
    var pending = await getPendingDraft();
    if (pending) {
      log('保存前の下書きを復元します');
      currentDraft = pending;
      fillConfirmView(currentDraft);
      showView('view-confirm');
      setStatus('前回の続き(未保存の下書き)を表示しています。', 'info');
    }
  } catch (err) {
    console.error(LOG_PREFIX, err);
    setStatus('起動時にエラーが発生しました: ' + err.message, 'error');
  }
});

function bindEvents() {
  $('btn-capture').addEventListener('click', captureCurrentPage);
  $('btn-show-list').addEventListener('click', showListView);
  $('btn-open-options').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  // 確認画面
  $('btn-img-all').addEventListener('click', function () { setAllImages(true); });
  $('btn-img-none').addEventListener('click', function () { setAllImages(false); });
  $('btn-save').addEventListener('click', saveDraft);
  $('btn-cancel').addEventListener('click', cancelDraft);
  $('f-price').addEventListener('input', updateJpyPreview);

  // 完了画面
  $('btn-copy-sns').addEventListener('click', copySnsText);
  $('btn-done-home').addEventListener('click', function () {
    setStatus('');
    showView('view-home');
  });

  // 一覧画面
  $('btn-back-home').addEventListener('click', function () {
    setStatus('');
    showView('view-home');
  });
  $('btn-export-json').addEventListener('click', exportJson);
  $('btn-export-csv').addEventListener('click', exportCsv);
}

/** ホーム画面に「いまのページが商品ページかどうか」を表示 */
async function updatePageInfo() {
  var tab = await getActiveTab();
  var info = $('page-info');
  if (tab && looksLikeProductPage(tab.url)) {
    info.textContent = 'Taobaoの商品ページを開いています。ボタンを押すと取り込みます。';
    info.style.color = '#1d7a1d';
  } else {
    info.textContent = '⚠ Taobaoの商品ページではない可能性があります。商品ページを開いてから押してください。';
    info.style.color = '#c0392b';
  }
}

// ------------------------------------------------------------
// STEP 3〜5: 取り込み(ボタンを押したときだけ実行)
// ------------------------------------------------------------

async function captureCurrentPage() {
  try {
    setStatus('取り込み中です…', 'info');
    $('btn-capture').disabled = true;

    var tab = await getActiveTab();
    if (!tab) throw new Error('アクティブなタブが見つかりません');

    // 取り込みスクリプトを「いまのタブにだけ」注入して、結果メッセージを待つ
    var result = await new Promise(function (resolve, reject) {
      var finished = false;

      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('取り込みが時間切れになりました。ページを再読み込みして試してください。'));
      }, 15000);

      function onMessage(msg, sender) {
        if (msg && msg.type === 'MAMC_EXTRACT_RESULT' &&
            sender.tab && sender.tab.id === tab.id) {
          cleanup();
          resolve(msg.payload);
        }
      }

      function cleanup() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(onMessage);
      }

      chrome.runtime.onMessage.addListener(onMessage);

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/selectors.js', 'content/extractor.js']
      }).catch(function (err) {
        cleanup();
        reject(new Error('ページにアクセスできませんでした: ' + err.message));
      });
    });

    if (!result || result.ok === false) {
      throw new Error((result && result.error) || '取り込みに失敗しました');
    }
    log('取り込み結果を受信:', result);

    // 重複チェック(同じ商品ID/URLは登録させない)
    var dup = await findDuplicate(result.itemId, result.url);
    if (dup) {
      setStatus('この商品はすでに登録されています(管理番号: ' +
        dup.managementNumber + ')', 'error');
      return;
    }

    // 確認画面用の下書きを作る(画像は最初は全部チェックON)
    currentDraft = {
      title: result.title || '',
      priceCny: result.priceCny,
      originalPriceCny: result.originalPriceCny,
      url: result.url || '',
      itemId: result.itemId || '',
      colors: result.colors || [],
      sizes: result.sizes || [],
      skuText: result.skuText || '',
      images: (result.images || []).map(function (url) {
        return { url: url, selected: true };
      }),
      warnings: result.warnings || [],
      extractedAt: result.extractedAt
    };
    await savePendingDraft(currentDraft);

    fillConfirmView(currentDraft);
    showView('view-confirm');
    setStatus('取り込みました。内容を確認して保存してください。', 'success');
  } catch (err) {
    console.error(LOG_PREFIX, err);
    setStatus('エラー: ' + err.message, 'error');
  } finally {
    $('btn-capture').disabled = false;
  }
}

// ------------------------------------------------------------
// STEP 6: 確認画面
// ------------------------------------------------------------

/** 下書きデータを確認画面のフォームに反映する */
function fillConfirmView(draft) {
  $('f-title').value = draft.title || '';
  $('f-price').value = (draft.priceCny !== null && draft.priceCny !== undefined) ? draft.priceCny : '';
  $('f-original-price').value = (draft.originalPriceCny !== null && draft.originalPriceCny !== undefined) ? draft.originalPriceCny : '';
  $('f-url').value = draft.url || '';
  $('f-item-id').value = draft.itemId || '';
  $('f-colors').value = (draft.colors || []).join('、');
  $('f-sizes').value = (draft.sizes || []).join('、');
  $('f-sku').value = draft.skuText || '';

  // 取得できなかった項目の一覧
  var warnEl = $('confirm-warnings');
  if (draft.warnings && draft.warnings.length > 0) {
    warnEl.textContent = '⚠ ' + draft.warnings.join('\n⚠ ');
    warnEl.hidden = false;
  } else {
    warnEl.hidden = true;
  }

  renderImageGrid(draft);
  updateJpyPreview();
}

/** 画像一覧(チェックボックス付き)を描画 */
function renderImageGrid(draft) {
  var grid = $('image-grid');
  grid.textContent = '';

  (draft.images || []).forEach(function (item, index) {
    var box = document.createElement('div');
    box.className = 'image-item' + (item.selected ? ' selected' : '');

    var check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.selected;
    check.addEventListener('change', function () {
      item.selected = check.checked;
      box.className = 'image-item' + (item.selected ? ' selected' : '');
      updateImageCount();
      savePendingDraft(currentDraft);
    });

    var img = document.createElement('img');
    img.src = item.url;
    img.alt = '商品画像 ' + (index + 1);
    img.loading = 'lazy';
    // 読み込めなかった画像は薄く表示する
    img.addEventListener('error', function () { box.style.opacity = '0.3'; });
    // 画像クリックでもチェックを切り替えられるようにする
    img.addEventListener('click', function () {
      check.checked = !check.checked;
      check.dispatchEvent(new Event('change'));
    });

    box.appendChild(check);
    box.appendChild(img);
    grid.appendChild(box);
  });

  updateImageCount();
}

function updateImageCount() {
  var count = 0;
  if (currentDraft && currentDraft.images) {
    currentDraft.images.forEach(function (i) { if (i.selected) count++; });
  }
  $('img-count').textContent = count;
}

/** すべて選択 / すべて解除 */
function setAllImages(selected) {
  if (!currentDraft) return;
  currentDraft.images.forEach(function (i) { i.selected = selected; });
  renderImageGrid(currentDraft);
  savePendingDraft(currentDraft);
}

/** 人民元価格の入力に合わせて日本円販売価格を表示 */
async function updateJpyPreview() {
  var settings = await getSettings();
  var priceCny = parseFloat($('f-price').value);
  var jpy = calculateSellingPrice(priceCny, settings.price);
  $('jpy-price').textContent = (jpy !== null) ? formatJpy(jpy) : '-';
  $('jpy-detail').textContent = describeSellingPrice(priceCny, settings.price);
}

async function cancelDraft() {
  currentDraft = null;
  await clearPendingDraft();
  setStatus('取り込みをキャンセルしました。', 'info');
  showView('view-home');
}

// ------------------------------------------------------------
// STEP 7〜9: 保存(管理番号・価格計算・SNS文生成)
// ------------------------------------------------------------

async function saveDraft() {
  try {
    if (!currentDraft) throw new Error('保存するデータがありません');

    var title = $('f-title').value.trim();
    var priceCny = parseFloat($('f-price').value);
    if (!title) {
      setStatus('商品名を入力してください。', 'error');
      return;
    }
    if (!isFinite(priceCny) || priceCny <= 0) {
      setStatus('現在価格(人民元)を入力してください。', 'error');
      return;
    }

    var itemId = $('f-item-id').value.trim();
    var url = $('f-url').value.trim();

    // 保存直前にもう一度重複チェック(手入力でIDが変わった場合にも対応)
    var dup = await findDuplicate(itemId, url);
    if (dup) {
      setStatus('この商品はすでに登録されています(管理番号: ' +
        dup.managementNumber + ')', 'error');
      return;
    }

    var settings = await getSettings();
    var originalPrice = parseFloat($('f-original-price').value);
    var selectedImages = currentDraft.images
      .filter(function (i) { return i.selected; })
      .map(function (i) { return i.url; });

    // 管理番号を発行(MAMC-000001 …)
    var managementNumber = await generateManagementNumber(settings.numberPrefix);

    var product = {
      managementNumber: managementNumber,
      title: title,
      taobaoItemId: itemId,
      url: url,
      priceCny: priceCny,
      originalPriceCny: isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null,
      priceJpy: calculateSellingPrice(priceCny, settings.price),
      colors: splitList($('f-colors').value),
      sizes: splitList($('f-sizes').value),
      skuText: $('f-sku').value.trim(),
      mainImage: selectedImages.length > 0 ? selectedImages[0] : '',
      images: selectedImages,
      createdAt: new Date().toISOString()
    };
    product.snsText = generateSnsText(product, settings.snsTemplate);

    await addProduct(product);
    await clearPendingDraft();
    currentDraft = null;
    lastSavedProduct = product;
    log('保存しました:', product.managementNumber);

    // 完了画面
    $('done-number').textContent = product.managementNumber;
    $('done-sns').value = product.snsText;
    setStatus('保存しました。', 'success');
    showView('view-done');
  } catch (err) {
    console.error(LOG_PREFIX, err);
    setStatus('保存に失敗しました: ' + err.message, 'error');
  }
}

async function copySnsText() {
  try {
    await navigator.clipboard.writeText($('done-sns').value);
    setStatus('SNS投稿文をコピーしました。', 'success');
  } catch (err) {
    setStatus('コピーに失敗しました。文章を選択して手動でコピーしてください。', 'error');
  }
}

// ------------------------------------------------------------
// 一覧画面・出力
// ------------------------------------------------------------

async function showListView() {
  var products = await getProducts();
  $('list-count').textContent = products.length;

  var listEl = $('product-list');
  listEl.textContent = '';

  if (products.length === 0) {
    var empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'まだ商品が保存されていません。';
    listEl.appendChild(empty);
  }

  products.forEach(function (p) {
    var item = document.createElement('div');
    item.className = 'product-item';

    var img = document.createElement('img');
    if (p.mainImage) img.src = p.mainImage;
    img.alt = '';

    var info = document.createElement('div');
    info.className = 'p-info';

    var numberDiv = document.createElement('div');
    numberDiv.className = 'p-number';
    numberDiv.textContent = p.managementNumber;

    var titleDiv = document.createElement('div');
    titleDiv.className = 'p-title';
    titleDiv.textContent = p.title;

    var priceDiv = document.createElement('div');
    priceDiv.className = 'p-price';
    priceDiv.textContent = p.priceCny + '元 → ' + formatJpy(p.priceJpy);

    info.appendChild(numberDiv);
    info.appendChild(titleDiv);
    info.appendChild(priceDiv);

    var buttons = document.createElement('div');
    buttons.className = 'p-buttons';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'small-btn';
    copyBtn.textContent = 'SNS文';
    copyBtn.title = 'SNS投稿文をコピー';
    copyBtn.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(p.snsText || '');
        setStatus(p.managementNumber + ' のSNS投稿文をコピーしました。', 'success');
      } catch (e) {
        setStatus('コピーに失敗しました。', 'error');
      }
    });

    var delBtn = document.createElement('button');
    delBtn.className = 'small-btn';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async function () {
      if (!confirm(p.managementNumber + ' を削除しますか?')) return;
      await deleteProduct(p.managementNumber);
      setStatus(p.managementNumber + ' を削除しました。', 'info');
      showListView(); // 一覧を描き直す
    });

    buttons.appendChild(copyBtn);
    buttons.appendChild(delBtn);

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(buttons);
    listEl.appendChild(item);
  });

  showView('view-list');
}

async function exportJson() {
  var products = await getProducts();
  if (products.length === 0) {
    setStatus('出力する商品がありません。', 'error');
    return;
  }
  downloadTextFile(
    'mamc-products-' + timestampForFilename() + '.json',
    productsToJson(products),
    'application/json'
  );
  setStatus('JSONファイルをダウンロードしました。', 'success');
}

async function exportCsv() {
  var products = await getProducts();
  if (products.length === 0) {
    setStatus('出力する商品がありません。', 'error');
    return;
  }
  downloadTextFile(
    'mamc-products-' + timestampForFilename() + '.csv',
    productsToCsv(products),
    'text/csv'
  );
  setStatus('CSVファイルをダウンロードしました。', 'success');
}
