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
    assert.match(vals.banner, /「入力内容を確認する」を押してください/);
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

// ---- パソコンの BUYMA の出品画面（部品の作りを再現したページ）で、全部入れる ----
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function openPcPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/buyma_pc_listing.html'), 'utf8'));
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/buyma-fill.js'), 'utf8') });
  return { browser, page };
}

const FULL = {
  title: 'ウール ワイドパンツ グレー',
  description: '【商品について】\nやわらかいウールです。',
  price: '12800',
  shopName: 'MAMC旗舰店',
  memo: '仕入れ先：https://item.taobao.com/item.htm?id=1',
  sizeNote: 'ウエスト 約70cm',
  category: 'レディースファッション > ボトムス > パンツ',
  brand: 'MAMC',
  shipping: '日本郵便 - ゆうパック｜【通常便（本州・四国・九州）】ご購入後3～5日で発送',
  images: [
    { name: 'taobao_1_01.jpg', type: 'image/jpeg', base64: TINY_JPEG },
    { name: 'taobao_1_02.jpg', type: 'image/jpeg', base64: TINY_JPEG },
  ],
};

test('パソコンの出品画面：文字・カテゴリ3段・ブランド・配送方法・画像を1回で入れる', async () => {
  const { browser, page } = await openPcPage();
  try {
    const r = await page.evaluate((v) => RakuBuymaFill.fillBuymaAll(document, v), FULL);
    const got = await page.evaluate(() => ({
      title: document.getElementById('title').value,
      price: document.getElementById('price').value,
      sizeNote: document.getElementById('sizeNote').value,
      colorName: document.getElementById('colorName').value,
      category: window.__category,
      brand: window.__brand,
      shipping: Array.from(document.querySelectorAll('#ship input')).map((i) => i.checked),
      files: window.__files,
      clicked: window.__clicked || null,
    }));
    assert.equal(got.title, 'ウール ワイドパンツ グレー');
    assert.equal(got.price, '12800');
    assert.equal(got.sizeNote, 'ウエスト 約70cm');
    assert.equal(got.colorName, '', '色の表には入れない');
    assert.deepEqual(got.category, ['レディースファッション', 'ボトムス', 'パンツ']);
    assert.equal(got.brand, 'MAMC(エムエーエムシー)', '読み方付きの同じ名前の候補を選ぶ');
    assert.deepEqual(got.shipping, [true, false, false, false, false], '説明文まで一致する1行だけ');
    assert.deepEqual(got.files.map((f) => [f.name, f.type]), [['taobao_1_01.jpg', 'image/jpeg'], ['taobao_1_02.jpg', 'image/jpeg']]);
    assert.ok(got.files[0].size > 100);
    assert.equal(got.clicked, null, '確定・下書き保存のボタンは押さない');
    assert.ok(r.filled.includes('カテゴリ（レディースファッション > ボトムス > パンツ）'));
    assert.ok(r.filled.includes('商品画像（2枚）'));
  } finally {
    await browser.close();
  }
});

test('合わないカテゴリ・同じ名前が複数ある配送方法は、勝手に選ばずに知らせる', async () => {
  const { browser, page } = await openPcPage();
  try {
    const r = await page.evaluate(
      (v) => RakuBuymaFill.fillBuymaAll(document, v),
      { title: 'x', category: 'キッズ > 靴', brand: '', shipping: '日本郵便 - ゆうパック' }
    );
    const got = await page.evaluate(() => ({
      category: window.__category || [],
      shipping: Array.from(document.querySelectorAll('#ship input')).map((i) => i.checked),
      noBrand: document.getElementById('noBrand').checked,
    }));
    assert.deepEqual(got.category, []);
    assert.deepEqual(got.shipping, [false, false, false, false, false]);
    assert.equal(got.noBrand, false, '「ブランド指定なし」も勝手に選ばない');
    assert.ok(r.notes.some((n) => n.includes('カテゴリ「キッズ」')));
    assert.ok(r.notes.some((n) => n.includes('2つある')));
    assert.ok(r.notes.some((n) => n.includes('ブランドは仕入れ先で確認できなかった')));
  } finally {
    await browser.close();
  }
});

test('配送方法の取り込み：名前と説明文を一言一句そのまま。使えない行は除く', async () => {
  const { browser, page } = await openPcPage();
  try {
    const list = await page.evaluate(() => RakuBuymaFill.readShippingOptions(document));
    assert.deepEqual(list, [
      '日本郵便 - ゆうパック｜【通常便（本州・四国・九州）】ご購入後3～5日で発送',
      '日本郵便 - ゆうパック｜【通常便（北海道・沖縄・離島）】ご購入後3～4日で発送',
      'ヤマト運輸 - ネコポス｜追跡番号付きポスト投函でのお届けです。',
      'ヤマト運輸　-　宅急便',
    ]);
    // 取り込んだ名前なら必ず1行に決まる
    for (const name of list) {
      const n = await page.evaluate((s) => RakuBuymaFill.matchShipping(
        Array.from(document.querySelectorAll('#ship tr')).filter((tr) => !tr.className.includes('disabled')).map((tr) => {
          const ps = tr.querySelectorAll('td p');
          const d = tr.querySelector('.bmm-c-form-table__desc');
          return { name: ps[0].textContent.trim(), desc: d ? d.textContent.trim() : '' };
        }), s).length, name);
      assert.equal(n, 1, name);
    }
  } finally {
    await browser.close();
  }
});

test('すでに選ばれているカテゴリ・チェックの付いた配送方法・登録済みの画像は変えない', async () => {
  const { browser, page } = await openPcPage();
  try {
    await page.evaluate(async () => {
      // カテゴリを先に自分で選んでおく
      const c = document.querySelector('#catLevels .Select-control');
      c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 120));
      document.querySelectorAll('.Select-option')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 120));
      document.querySelector('#ship tr').click();
      document.querySelector('.bmm-c-img-upload__box').classList.remove('bmm-c-img-upload__box--empty');
    });
    const r = await page.evaluate((v) => RakuBuymaFill.fillBuymaAll(document, v), FULL);
    const got = await page.evaluate(() => ({ category: window.__category, files: window.__files || null }));
    assert.deepEqual(got.category, ['メンズファッション']);
    assert.equal(got.files, null);
    assert.ok(r.skipped.includes('カテゴリ'));
    assert.ok(r.skipped.includes('配送方法'));
    assert.ok(r.skipped.includes('商品画像'));
  } finally {
    await browser.close();
  }
});
