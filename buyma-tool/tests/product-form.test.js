// 確認・修正画面と商品データの行き来（product-form.js）のテスト
const { test } = require('node:test');
const assert = require('node:assert/strict');
const PF = require('../extension/src/product-form.js');
const { shortHash } = require('../extension/src/page-reader.js');

const site = {
  source: 'taobao', itemId: '7001', url: 'https://item.taobao.com/item.htm?id=7001', title: '羊毛大衣',
  price: { min: 459, max: 459, currency: 'CNY', raw: '459' },
  skus: [
    { name: '颜色分类', values: [{ name: '驼色', image: '', disabled: false }, { name: '黑色', image: '', disabled: true }] },
    { name: '尺码', values: [{ name: 'S', image: '', disabled: false }] },
    { name: '套餐', values: [{ name: '单件', image: '', disabled: false }] },
  ],
  specs: [{ name: '材质', value: '羊毛90%' }],
  images: ['https://img.alicdn.com/a.jpg', 'https://img.alicdn.com/b.jpg'],
  complete: true,
};

test('専用読み取りで全部取れていれば、AI の結果は使わない', () => {
  assert.equal(PF.chooseProduct(site, { title: 'AI' }), site);
});

test('専用読み取りが不完全なら AI の結果を使い、画像がなければ専用読み取りの画像を使う', () => {
  const partial = Object.assign({}, site, { complete: false, price: null });
  const ai = { source: 'taobao', itemId: '', url: site.url, title: '羊毛大衣', price: { min: 459, max: 459, currency: 'CNY', raw: '' }, skus: [], specs: [], images: [] };
  const p = PF.chooseProduct(partial, ai);
  assert.deepEqual(p.images, site.images);
  assert.equal(p.itemId, '7001');
  assert.equal(p.complete, true);
  assert.equal(PF.chooseProduct(null, ai).complete, false); // AI だけで画像なし
});

test('画面で直した内容から商品データに戻す（品切れ・色・サイズ・仕様・外した画像）', () => {
  const form = PF.formFromProduct(site);
  assert.equal(form.colors, '驼色\n黑色（品切れ）');
  assert.equal(form.sizes, 'S');
  assert.equal(form.specs, '材质: 羊毛90%\n套餐: 单件');
  form.priceMax = '399'; // 高い方に安い値を入れても、min/max を正しく並べる
  form.currency = 'KRW';
  form.images[1].keep = false;
  const p = PF.productFromForm(form, site);
  assert.deepEqual(p.price, { min: 399, max: 459, currency: 'KRW', raw: '' });
  assert.deepEqual(p.skus[0].values.map((v) => [v.name, v.disabled]), [['驼色', false], ['黑色', true]]);
  assert.equal(p.skus[1].name, 'サイズ');
  assert.deepEqual(p.specs, [{ name: '材质', value: '羊毛90%' }, { name: '套餐', value: '单件' }]);
  assert.deepEqual(p.images, ['https://img.alicdn.com/a.jpg']);
  assert.equal(p.itemId, '7001');
  assert.equal(p.complete, true);
});

test('価格が空なら price は null、未完了になる', () => {
  const p = PF.productFromForm({ title: 'x', priceMin: '', priceMax: '', currency: 'USD', colors: '', sizes: '', specs: '', images: [] }, {});
  assert.equal(p.price, null);
  assert.equal(p.complete, false);
});

test('商品IDのないサイトは URL の目印を商品IDにする（画像ZIPと CSV のファイル名をそろえる）', () => {
  const p = PF.ensureItemId({ itemId: '', url: 'https://boutique.example.fr/sac?ref=1' }, shortHash);
  assert.equal(p.itemId, shortHash('https://boutique.example.fr/sac'));
  assert.equal(PF.ensureItemId({ itemId: '7001', url: 'x' }, shortHash).itemId, '7001');
});

test('全部まとめてコピーの文章', () => {
  const t = PF.listingText({ title: 'ウール ロングコート', priceJpy: '9800', category: 'レディース > コート', brand: '', colors: 'キャメル / ブラック', description: '本文です' });
  assert.equal(t, 'タイトル：ウール ロングコート\n価格（円）：9800\nカテゴリー候補：レディース > コート\n色：キャメル / ブラック\n\n商品コメント：\n本文です');
});
