/**
 * storage.js
 * ============================================================
 * 商品データ・ブランド・仕入れ先・設定の保存を担当するファイル。
 * データはすべて chrome.storage.local（拡張機能内）に保存されます。
 * 外部サーバーには一切送信しません。
 *
 * 保存している内容：
 *   products    取り込んだ商品の配列
 *   brands      ブランドの配列（価格ルール・タイトルルール込み）
 *   suppliers   仕入れ先サイト名のリスト
 *   counters    管理番号の連番（ブランドの prefix ごとに別々）
 *               例: { MAMC: 3, OLDORDER: 1 }
 *   settings    共通設定（連番の桁数など）
 *   snsTemplate SNS投稿文のテンプレート
 * ============================================================
 */

/** ストレージから全データを読み込む（無ければ初期値。旧バージョンのデータは自動変換） */
async function dbLoad() {
  const raw = await chrome.storage.local.get(null);

  const data = {
    products: raw.products || [],
    brands: (raw.brands && raw.brands.length > 0)
      ? raw.brands
      : JSON.parse(JSON.stringify(DEFAULT_BRANDS)),
    suppliers: (raw.suppliers && raw.suppliers.length > 0)
      ? raw.suppliers
      : DEFAULT_SUPPLIERS.slice(),
    counters: raw.counters || {},
    settings: Object.assign({}, DEFAULT_GLOBAL_SETTINGS, raw.settings || {}),
    snsTemplate: raw.snsTemplate || DEFAULT_SNS_TEMPLATE
  };

  // ---- 旧バージョン（MAMC/Taobao専用時代）からの自動引き継ぎ ----
  // 目印：昔は全体で1つの連番 nextSeq を使っていた
  if (raw.nextSeq && !raw.counters) {
    console.log('[商品取り込み] 旧バージョンのデータを引き継ぎます');

    // 連番は MAMC ブランドに引き継ぐ
    data.counters['MAMC'] = raw.nextSeq;

    // 旧設定（為替レート等）は MAMC ブランドの価格ルールへ
    const old = raw.settings || {};
    const mamc = data.brands.find((b) => b.prefix === 'MAMC');
    if (mamc && old.exchangeRate) {
      mamc.priceRule = {
        exchangeRate: old.exchangeRate,
        steps: [
          { op: 'add', value: old.shippingJpy || 0 },
          { op: 'percent', value: old.profitRate || 0 }
        ],
        roundUnit: old.roundUnit || 100
      };
    }

    // 旧商品データに新しい項目を付ける
    for (const p of data.products) {
      if (!p.brand) p.brand = 'MAMC';
      if (!p.brandPrefix) p.brandPrefix = 'MAMC';
      if (!p.supplier) p.supplier = 'Taobao';
      if (!p.originalTitle) p.originalTitle = p.title;
      if (p.priceOriginal === undefined) p.priceOriginal = p.priceCny ?? null;
      if (!p.currency) p.currency = 'CNY';
      if (!p.productId) p.productId = p.taobaoId || '';
    }

    // 変換後の形で保存し直し、古いキーは消す
    await chrome.storage.local.set({
      products: data.products,
      brands: data.brands,
      suppliers: data.suppliers,
      counters: data.counters
    });
    await chrome.storage.local.remove('nextSeq');
  }

  return data;
}

// ---------- 設定・ブランド・仕入れ先の保存 ----------

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function saveBrands(brands) {
  await chrome.storage.local.set({ brands });
}

async function saveSuppliers(suppliers) {
  await chrome.storage.local.set({ suppliers });
}

async function saveSnsTemplate(snsTemplate) {
  await chrome.storage.local.set({ snsTemplate });
}

// ---------- 商品 ----------

/** 保存済みの商品一覧を読み込む（新しい順） */
async function getProducts() {
  const data = await dbLoad();
  return data.products.slice().reverse();
}

/**
 * 商品URLを比較用に正規化する。
 * トラッキング用のパラメータが付いても同じ商品と判定できるよう、
 * 「ドメイン + id系パラメータ（あれば）」だけにして比べます。
 */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url);
    // 商品IDらしきパラメータがあればそれを使う
    for (const key of ['id', 'itemid', 'item_id', 'pid', 'product_id', 'goodsid', 'sku']) {
      const v = u.searchParams.get(key);
      if (v) return u.hostname + '?' + key + '=' + v;
    }
    return u.hostname + u.pathname;
  } catch (e) {
    return url || '';
  }
}

/**
 * すでに登録済みの商品かどうか調べる。
 * 商品IDが同じ、またはURL（正規化後）が同じなら重複とみなす。
 * @returns 登録済みならその商品、無ければ null
 */
async function findDuplicate(productId, url) {
  const data = await dbLoad();
  const normUrl = normalizeProductUrl(url);
  for (const p of data.products) {
    const pid = p.productId || p.taobaoId; // 旧データ互換
    if (productId && pid && pid === productId) return p;
    if (normUrl && normalizeProductUrl(p.url) === normUrl) return p;
  }
  return null;
}

/** 管理番号を作る（例: MAMC-000001, OLDORDER-000001） */
function buildCode(prefix, seq, digits) {
  return prefix + '-' + String(seq).padStart(digits || 6, '0');
}

/**
 * 商品を保存する。ブランドごとの連番で管理番号を自動採番して返す。
 * @param {object} product - 確認画面で確定した商品データ（brandPrefix を含む）
 * @returns {object} 管理番号が付いた保存済み商品
 */
async function saveProduct(product) {
  const data = await dbLoad();

  // 保存直前にも重複チェック（念のため二重登録を防ぐ）
  const dup = await findDuplicate(product.productId, product.url);
  if (dup) {
    const err = new Error('この商品はすでに登録されています（' + dup.code + '）');
    err.duplicateOf = dup;
    throw err;
  }

  const prefix = product.brandPrefix || 'ITEM';
  const seq = data.counters[prefix] || 1;

  const saved = Object.assign({}, product, {
    code: buildCode(prefix, seq, data.settings.codeDigits),
    createdAt: new Date().toISOString()
  });

  data.products.push(saved);
  data.counters[prefix] = seq + 1;
  await chrome.storage.local.set({
    products: data.products,
    counters: data.counters
  });
  console.log('[商品取り込み] 保存しました:', saved.code, saved.title);
  return saved;
}

/** 管理番号を指定して商品を1件削除する */
async function deleteProduct(code) {
  const data = await dbLoad();
  const products = data.products.filter((p) => p.code !== code);
  await chrome.storage.local.set({ products });
}
