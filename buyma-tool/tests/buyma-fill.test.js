// 「BUYMAに反映」：BUYMA の出品画面（スマホで見た見出しを再現したページ）に入れる
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const PF = require('../extension/src/product-form.js');

test('BUYMA に入れる値：価格は整数、出品メモに仕入れ先と仕入れ値', () => {
  const v = PF.buymaValues(
    { title: 'ウール ワイドパンツ', description: '説明', priceJpy: '12800' },
    { url: 'https://item.taobao.com/item.htm?id=1', price: { min: 199, max: 239, currency: 'CNY' }, shopName: 'MAMC旗舰店' }
  );
  assert.equal(v.price, '12800');
  assert.equal(v.shopName, 'MAMC旗舰店');
  assert.equal(v.memo, '仕入れ先：https://item.taobao.com/item.htm?id=1\n仕入れ値：199〜239 CNY\n（ラク出品で作成）');
  assert.equal(PF.isBuymaUrl('https://www.buyma.com/my/sell/new/'), true);
  assert.equal(PF.isBuymaUrl('https://buyma.com.evil.example/'), false);
});

test('見出しから欄を探して入れる。入っている欄は上書きせず、ボタンは押さない', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/buyma_new_listing.html'), 'utf8'));
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/buyma-fill.js'), 'utf8') });
    const r = await page.evaluate(() =>
      RakuBuymaFill.fillBuyma(document, {
        title: 'ウール ワイドパンツ グレー',
        description: '【商品について】\nやわらかいウールです。',
        price: '12800',
        shopName: 'MAMC旗舰店',
        memo: '仕入れ先：https://item.taobao.com/item.htm?id=1',
      })
    );
    assert.deepEqual(r.filled, ['商品名', '商品コメント', '商品価格', '買付先ショップ名']);
    assert.deepEqual(r.skipped, ['出品メモ']);
    assert.deepEqual(r.missing, []);
    const vals = await page.evaluate(() => ({
      itemName: document.getElementById('itemName').value,
      comment: document.getElementById('comment').value,
      price: document.getElementById('price').value,
      refPriceValue: document.getElementById('refPriceValue').value,
      shop: document.getElementById('shop').value,
      brand: document.getElementById('brand').value,
      memo: document.getElementById('memo').value,
      clicked: window.__clicked || null,
      events: window.__events,
      banner: document.getElementById('rakushuppin-banner').textContent,
    }));
    assert.equal(vals.itemName, 'ウール ワイドパンツ グレー');
    assert.equal(vals.comment, '【商品について】\nやわらかいウールです。');
    assert.equal(vals.price, '12800');
    assert.equal(vals.refPriceValue, '', '参考価格には入れない');
    assert.equal(vals.shop, 'MAMC旗舰店');
    assert.equal(vals.brand, '', 'ブランドには入れない');
    assert.equal(vals.memo, '前からあるメモ', '自分で入れた内容は消さない');
    assert.equal(vals.clicked, null, 'ボタン（出品する・下書き保存）は押さない');
    assert.ok(vals.events.includes('itemName'), '画面が気づけるよう input イベントを出す');
    assert.match(vals.banner, /「出品する」を押してください/);
  } finally {
    await browser.close();
  }
});

test('欄が見つからないページでは、何も入れずに知らせる', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><h1>マイページ</h1><input type="text" id="q"></body></html>');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/buyma-fill.js'), 'utf8') });
    const r = await page.evaluate(() => RakuBuymaFill.fillBuyma(document, { title: 'x', price: '1' }));
    assert.deepEqual(r.filled, []);
    assert.deepEqual(r.missing, ['商品名', '商品価格']);
    assert.equal(await page.evaluate(() => document.getElementById('q').value), '');
  } finally {
    await browser.close();
  }
});
