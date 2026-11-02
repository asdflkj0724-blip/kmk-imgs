// BUYMA の出品画面への自動入力。見本のページ（本物ではない）で確かめる。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const src = (f) => fs.readFileSync(path.join(__dirname, '../extension/src', f), 'utf8');
const LISTING = { id: 'L1', title_ja: '双面ウールコート ロング丈', description_ja: '1行目\n2行目', price_jpy: 18900 };

async function withPage(fixture, fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8'));
    await page.addScriptTag({ content: src('buyma-config.js') });
    await page.addScriptTag({ content: src('buyma-fill.js') });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test('入力だけのとき：見出しから欄を見つけて入れ、ボタンは押さない', async () => {
  await withPage('buyma_form.html', async (page) => {
    const r = await page.evaluate((l) => BuymaFill.fillListing(document, l, { mode: 'fill' }), LISTING);
    assert.deepEqual(r.filled, ['title', 'description', 'price']);
    assert.deepEqual(r.missing, []);
    assert.equal(r.draftClicked, false);
    const v = await page.evaluate(() => ({
      t: document.getElementById('t').value,
      c: document.getElementById('c').value,
      p: document.getElementById('p').value,
      ref: document.getElementById('ref').value,
      brand: document.getElementById('brand').value,
      clicked: window.__clicked,
      events: window.__events,
      banner: document.getElementById('buyma-helper-banner').textContent,
    }));
    assert.equal(v.t, LISTING.title_ja);
    assert.equal(v.c, LISTING.description_ja);
    assert.equal(v.p, '18900');
    assert.equal(v.ref, ''); // 「参考価格」には入れない
    assert.equal(v.brand, '');
    assert.deepEqual(v.clicked, []);
    for (const id of ['t', 'c', 'p']) {
      assert.ok(v.events.includes('input:' + id), 'input イベント ' + id);
      assert.ok(v.events.includes('change:' + id), 'change イベント ' + id);
    }
    // 元の setter を使うので、入力欄に差し替えた setter は通らない（React と同じ扱い）
    assert.ok(!v.events.includes('instance-setter'));
    assert.match(v.banner, /入力しました/);
  });
});

test('下書き保存まで自動のとき：「下書き保存」だけを押し、「出品する」「公開」は押さない', async () => {
  await withPage('buyma_form.html', async (page) => {
    const r = await page.evaluate((l) => BuymaFill.fillListing(document, l, { mode: 'draft' }), LISTING);
    assert.equal(r.draftClicked, true);
    assert.deepEqual(await page.evaluate(() => window.__clicked), ['draft']);
  });
});

test('欄が足りないときは、下書きボタンも押さずに足りない項目を返す', async () => {
  await withPage('buyma_form_partial.html', async (page) => {
    const r = await page.evaluate((l) => BuymaFill.fillListing(document, l, { mode: 'draft' }), LISTING);
    assert.equal(r.ok, false);
    assert.deepEqual(r.filled, ['title']);
    assert.deepEqual(r.missing, ['商品コメント', '価格']);
    assert.equal(r.draftClicked, false);
    assert.deepEqual(await page.evaluate(() => window.__clicked), []);
  });
});
