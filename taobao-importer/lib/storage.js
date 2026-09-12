/**
 * storage.js
 * ============================================================
 * 商品データと設定の保存を担当します(chrome.storage.local を使用)。
 *
 * ・商品の追加/削除/一覧取得
 * ・管理番号(MAMC-000001 …)の採番
 * ・同じ商品ID/URLの重複チェック
 * ・設定(価格計算・SNSテンプレート)の読み書き
 *
 * 将来 Googleスプレッドシート等と連携するときは、
 * このファイルの関数の中身を差し替えれば他の画面はそのまま使えます。
 * ============================================================
 */

'use strict';

var STORAGE_KEYS = {
  products: 'products',       // 保存した商品の配列
  counter: 'productCounter',  // 管理番号の連番(数値)
  settings: 'settings',       // 設定
  pending: 'pendingDraft'     // 確認画面の途中データ(ポップアップが閉じても復元できるように)
};

/** storageから1つ読み出す */
async function storageGet(key) {
  var obj = await chrome.storage.local.get(key);
  return obj[key];
}

/** storageに1つ書き込む */
async function storageSet(key, value) {
  var obj = {};
  obj[key] = value;
  await chrome.storage.local.set(obj);
}

// ------------------------------------------------------------
// 商品
// ------------------------------------------------------------

/** 保存済み商品の一覧(新しい順) */
async function getProducts() {
  return (await storageGet(STORAGE_KEYS.products)) || [];
}

/**
 * 同じTaobao商品ID または 同じURL の商品を探す。
 * 見つかればその商品を、無ければ null を返す。
 */
async function findDuplicate(itemId, url) {
  var products = await getProducts();
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    if (itemId && p.taobaoItemId && p.taobaoItemId === itemId) return p;
    if (url && p.url && p.url === url) return p;
  }
  return null;
}

/** 次の管理番号を発行する(例: MAMC-000001)。呼ぶたびに番号が進む。 */
async function generateManagementNumber(prefix) {
  var n = ((await storageGet(STORAGE_KEYS.counter)) || 0) + 1;
  await storageSet(STORAGE_KEYS.counter, n);
  var numberText = String(n);
  while (numberText.length < 6) numberText = '0' + numberText;
  return (prefix || 'MAMC') + '-' + numberText;
}

/** 商品を1件追加する(先頭=新しい順) */
async function addProduct(product) {
  var products = await getProducts();
  products.unshift(product);
  await storageSet(STORAGE_KEYS.products, products);
}

/** 管理番号を指定して商品を1件削除する */
async function deleteProduct(managementNumber) {
  var products = await getProducts();
  var remaining = products.filter(function (p) {
    return p.managementNumber !== managementNumber;
  });
  await storageSet(STORAGE_KEYS.products, remaining);
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------

/**
 * 設定を読み出す。保存されていない項目は初期値で補う。
 * 初期値そのものは price.js / sns.js に定義してあります。
 */
async function getSettings() {
  var saved = (await storageGet(STORAGE_KEYS.settings)) || {};
  return {
    numberPrefix: saved.numberPrefix || 'MAMC',
    price: Object.assign({}, DEFAULT_PRICE_SETTINGS, saved.price || {}),
    snsTemplate: saved.snsTemplate || DEFAULT_SNS_TEMPLATE
  };
}

/** 設定を保存する */
async function saveSettings(settings) {
  await storageSet(STORAGE_KEYS.settings, settings);
}

// ------------------------------------------------------------
// 確認画面の途中データ(下書き)
// ------------------------------------------------------------

async function savePendingDraft(draft) {
  await storageSet(STORAGE_KEYS.pending, draft);
}

async function getPendingDraft() {
  return (await storageGet(STORAGE_KEYS.pending)) || null;
}

async function clearPendingDraft() {
  await chrome.storage.local.remove(STORAGE_KEYS.pending);
}
