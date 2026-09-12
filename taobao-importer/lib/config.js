/**
 * config.js
 * ============================================================
 * 「初期値」をまとめたファイル。
 * 実際の値は設定画面（歯車マーク）から自由に変更でき、
 * chrome.storage に保存されます。ここは最初の1回だけ使われます。
 *
 * この拡張は特定サイト専用ではなく、どの通販サイトでも
 * 「いま自分で開いている商品ページ1件」を取り込む汎用ツールです。
 * ============================================================
 */

// ------------------------------------------------------------
// X自動投稿システム連携用CSV（products.csv）の列構成の初期値。
// 設定画面から並び替え・追加・削除できます。
// 使える列の名前（フィールド）は lib/export.js の csvFieldValue() 参照：
//   id, brand, product_name, original_title, price, original_price,
//   currency, product_url, product_id, image, images, color, size,
//   post_text, supplier, created_at
// ------------------------------------------------------------
const DEFAULT_CSV_COLUMNS = [
  'id',
  'brand',
  'product_name',
  'price',
  'original_price',
  'product_url',
  'image',
  'color',
  'size',
  'post_text'
];

// 全体共通の設定
const DEFAULT_GLOBAL_SETTINGS = {
  codeDigits: 6,                          // 管理番号の連番の桁数（6 → MAMC-000001）
  csvColumns: DEFAULT_CSV_COLUMNS.slice() // products.csv の列構成
};

// ------------------------------------------------------------
// 価格ルール（ブランドごとに持てます）
//   exchangeRate … 外貨サイト用の換算レート（日本円のサイトなら 1）
//   steps        … 上から順に適用される計算ステップ
//                    op: 'add'      → ＋value 円
//                    op: 'subtract' → −value 円
//                    op: 'multiply' → ×value 倍
//                    op: 'percent'  → ＋value ％
//   roundUnit    … 最後にこの単位で切り上げ（100 → 100円単位）
// ------------------------------------------------------------
const DEFAULT_PRICE_RULE = {
  exchangeRate: 1,
  steps: [{ op: 'percent', value: 30 }],
  roundUnit: 100
};

// 設定画面で使う、計算ステップの表示名
const PRICE_STEP_LABELS = {
  add: '＋ 円を足す',
  subtract: '− 円を引く',
  multiply: '× 倍にする',
  percent: '＋ ％上乗せ'
};

// ------------------------------------------------------------
// タイトルルール（ブランドごとに持てます）
//   format      … 最終的な並び。{{brand}} と {{title}} が置き換わる
//   removeWords … タイトルから削除したい文字のリスト
//   replaceList … 置き換えリスト [{ from: '古い文字', to: '新しい文字' }]
// ------------------------------------------------------------
const DEFAULT_TITLE_RULE = {
  format: '{{brand}} {{title}}',
  removeWords: [],
  replaceList: []
};

/** 新しいブランドの入れ物を作る（設定画面の「ブランドを追加」で使用） */
function createBrand(name, prefix) {
  return {
    name: name,                                   // 表示名（例: Old Order）
    prefix: prefix,                               // 管理番号の頭（例: OLD）
    priceRule: JSON.parse(JSON.stringify(DEFAULT_PRICE_RULE)),
    titleRule: JSON.parse(JSON.stringify(DEFAULT_TITLE_RULE)),
    snsTemplate: null // null = 共通のSNSテンプレートを使う
  };
}

// 最初から入っているブランド（設定画面で追加・削除・変更できます）
// snsTemplate が null のブランドは共通テンプレート（DEFAULT_SNS_TEMPLATE）を使い、
// {{brand}} の部分にブランド名が自動で入ります。
const DEFAULT_BRANDS = [
  {
    name: 'MAMC',
    prefix: 'MAMC',
    // 例：元価格(元) × 22円 → +送料2000円 → +利益30% → 100円単位切り上げ
    priceRule: {
      exchangeRate: 22,
      steps: [
        { op: 'add', value: 2000 },
        { op: 'percent', value: 30 }
      ],
      roundUnit: 100
    },
    titleRule: { format: '{{brand}} {{title}}', removeWords: [], replaceList: [] },
    snsTemplate: null
  },
  {
    name: 'Old Order',
    prefix: 'OLD',
    priceRule: {
      exchangeRate: 22,
      steps: [
        { op: 'add', value: 2000 },
        { op: 'percent', value: 30 }
      ],
      roundUnit: 100
    },
    titleRule: { format: '{{brand}} {{title}}', removeWords: [], replaceList: [] },
    snsTemplate: null
  },
  {
    name: 'FVVO',
    prefix: 'FVVO',
    priceRule: {
      exchangeRate: 22,
      steps: [
        { op: 'add', value: 2000 },
        { op: 'percent', value: 30 }
      ],
      roundUnit: 100
    },
    titleRule: { format: '{{brand}} {{title}}', removeWords: [], replaceList: [] },
    snsTemplate: null
  },
  {
    name: 'その他',
    prefix: 'OTHER',
    priceRule: {
      exchangeRate: 22,
      steps: [
        { op: 'add', value: 2000 },
        { op: 'percent', value: 30 }
      ],
      roundUnit: 100
    },
    // 「その他」はタイトルの先頭にブランド名を付けない
    titleRule: { format: '{{title}}', removeWords: [], replaceList: [] },
    snsTemplate: null
  }
];

// 仕入れ先サイトの初期リスト（設定画面で自由に増減できます）
const DEFAULT_SUPPLIERS = ['Taobao', '公式サイト', 'その他'];

// SNS投稿文のテンプレート。設定画面から自由に変更できます。
// 使える置き換えワード：
//   {{code}} 管理番号 / {{brand}} ブランド名 / {{title}} 販売タイトル
//   {{priceJpy}} 販売価格 / {{priceOriginal}} 元価格
//   {{colors}} カラー / {{sizes}} サイズ / {{url}} 商品URL
const DEFAULT_SNS_TEMPLATE = `{{brand}} 新着商品✨

商品番号：{{code}}
価格：{{priceJpy}}

カラー：{{colors}}
サイズ：{{sizes}}

気になる方は商品番号「{{code}}」を送ってください。
在庫・サイズを確認します。

詳細画像をご希望の場合も商品番号を送ってください。`;
