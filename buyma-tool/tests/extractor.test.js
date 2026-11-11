// 実行: npm test（buyma-tool フォルダで）
// 本物のブラウザ（Chromium）で、保存した見本ページに抽出処理をかけて結果を確かめる。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { normalizeImageUrl, parsePrice, detectSource } = require('../extension/src/extractor.js');

const EXTRACTOR = fs.readFileSync(path.join(__dirname, '../extension/src/extractor.js'), 'utf8');

async function run(fixture, url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8'));
    await page.addScriptTag({ content: EXTRACTOR });
    return await page.evaluate((u) => BuymaExtractor.extractProduct(document, u), url);
  } finally {
    await browser.close();
  }
}

test('新しいタオバオのページ', async () => {
  const p = await run('taobao_new.html', 'https://item.taobao.com/item.htm?id=7001&spm=x');
  assert.equal(p.source, 'taobao');
  assert.equal(p.itemId, '7001');
  assert.equal(p.title, '2024新款 双面羊毛大衣女 中长款');
  assert.equal(p.price.min, 459); // 割引後の価格を優先
  assert.deepEqual(p.images, [
    'https://img.alicdn.com/imgextra/i1/111/O1CN01a.jpg',
    'https://img.alicdn.com/imgextra/i2/111/O1CN01b.jpg',
  ]);
  assert.equal(p.skus.length, 2);
  assert.equal(p.skus[0].name, '颜色分类');
  assert.deepEqual(p.skus[0].values.map((v) => [v.name, v.disabled]), [['驼色', false], ['黑色', true]]);
  assert.equal(p.skus[0].values[0].image, 'https://img.alicdn.com/c1.jpg');
  assert.deepEqual(p.skus[1].values.map((v) => v.name), ['S', 'M']);
  assert.deepEqual(p.specs, [
    { name: '材质', value: '羊毛90% 其他10%' },
    { name: '风格', value: '通勤' },
  ]);
  assert.equal(p.complete, true);
  assert.deepEqual(p.warnings, []);
});

test('古い天猫のページ', async () => {
  const p = await run('tmall_old.html', 'https://detail.tmall.com/item.htm?id=6002');
  assert.equal(p.source, 'tmall');
  assert.equal(p.title, '真皮 手提包 女 大容量');
  assert.equal(p.price.min, 999);
  assert.deepEqual(p.images, [
    'https://img.alicdn.com/bao/uploaded/i1/p1.jpg',
    'https://img.alicdn.com/bao/uploaded/i2/p2.png',
  ]);
  assert.equal(p.skus[0].name, '颜色分类');
  assert.equal(p.skus[0].values[0].image, 'https://img.alicdn.com/s1.jpg');
  assert.equal(p.skus[0].values[1].disabled, true);
  assert.deepEqual(p.specs, [
    { name: '品牌', value: '某品牌' },
    { name: '材质', value: '牛皮' },
  ]);
});

test('商品ページでないときは警告を出し、未完了にする', async () => {
  const p = await run('empty.html', 'https://login.taobao.com/');
  assert.equal(p.complete, false);
  assert.equal(p.price, null);
  assert.ok(p.warnings.includes('価格が取れませんでした'));
});

test('部品ごとの小さな確認', () => {
  assert.equal(normalizeImageUrl('data:image/gif;base64,AA'), '');
  assert.equal(normalizeImageUrl('//a.com/x.jpg_q50.jpg_.webp'), 'https://a.com/x.jpg');
  assert.deepEqual(parsePrice('¥1,299.00 - 1,599.00'), { min: 1299, max: 1599, currency: 'CNY', raw: '¥1,299.00 - 1,599.00' });
  assert.equal(parsePrice('价格面议'), null);
  assert.equal(detectSource('https://detail.tmall.hk/hk/item.htm?id=1'), 'tmall');
  assert.equal(detectSource('https://evil-taobao.com/'), 'unknown');
});
