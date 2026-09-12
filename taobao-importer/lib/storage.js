/**
 * storage.js
 * ============================================================
 * 商品データと設定の保存・読み込みを担当するファイル。
 * データはすべて chrome.storage.local（拡張機能内）に保存されます。
 * 外部サーバーには一切送信しません。
 *
 * 保存している内容：
 *   products    取り込んだ商品の配列
 *   nextSeq     次に使う管理番号の連番
 *   settings    設定（為替レートなど）
 *   snsTemplate SNS投稿文のテンプレート
 *
 * 将来 Googleスプレッドシート等と連携するときは、
 * このファイルの関数を呼ぶ「新しい連携ファイル」を追加すればOK
 * という設計にしてあります。
 * ============================================================
 */

/** ストレージから全データを読み込む（無ければ初期値） */
async function dbLoad() {
  const data = await chrome.storage.local.get({
    products: [],
    nextSeq: 1,
    settings: {},
    snsTemplate: null
  });
  // 設定は「初期値 + 保存済みの値」を合成して返す
  data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
  if (!data.snsTemplate) data.snsTemplate = DEFAULT_SNS_TEMPLATE;
  return data;
}

/** 設定だけ読み込む */
async function getSettings() {
  const data = await dbLoad();
  return data.settings;
}

/** 設定を保存する */
async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

/** SNSテンプレートを保存する */
async function saveSnsTemplate(snsTemplate) {
  await chrome.storage.local.set({ snsTemplate });
}

/** 保存済みの商品一覧を読み込む（新しい順） */
async function getProducts() {
  const data = await dbLoad();
  return data.products.slice().reverse();
}

/**
 * 商品URLを比較用に正規化する。
 * Taobao のURLはトラッキング用のパラメータが大量に付くので、
 * 「ドメイン + id 」だけにして比べます。
 */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return u.hostname + '?id=' + id;
    return u.hostname + u.pathname;
  } catch (e) {
    return url || '';
  }
}

/**
 * すでに登録済みの商品かどうか調べる。
 * Taobaoの商品IDが同じ、またはURL（正規化後）が同じなら重複とみなす。
 * @returns 登録済みならその商品、無ければ null
 */
async function findDuplicate(taobaoId, url) {
  const data = await dbLoad();
  const normUrl = normalizeProductUrl(url);
  for (const p of data.products) {
    if (taobaoId && p.taobaoId && p.taobaoId === taobaoId) return p;
    if (normUrl && normalizeProductUrl(p.url) === normUrl) return p;
  }
  return null;
}

/** 管理番号を作る（例: MAMC-000001） */
function buildCode(settings, seq) {
  const digits = settings.codeDigits || 6;
  return settings.codePrefix + '-' + String(seq).padStart(digits, '0');
}

/**
 * 商品を保存する。管理番号を自動で採番して返す。
 * @param {object} product - 確認画面で確定した商品データ
 * @returns {object} 管理番号が付いた保存済み商品
 */
async function saveProduct(product) {
  const data = await dbLoad();

  // 保存直前にも重複チェック（念のため二重登録を防ぐ）
  const dup = await findDuplicate(product.taobaoId, product.url);
  if (dup) {
    const err = new Error('この商品はすでに登録されています（' + dup.code + '）');
    err.duplicateOf = dup;
    throw err;
  }

  const saved = Object.assign({}, product, {
    code: buildCode(data.settings, data.nextSeq),
    createdAt: new Date().toISOString()
  });

  data.products.push(saved);
  await chrome.storage.local.set({
    products: data.products,
    nextSeq: data.nextSeq + 1
  });
  console.log('[MAMC取り込み] 保存しました:', saved.code, saved.title);
  return saved;
}

/** 管理番号を指定して商品を1件削除する */
async function deleteProduct(code) {
  const data = await dbLoad();
  const products = data.products.filter((p) => p.code !== code);
  await chrome.storage.local.set({ products });
}
