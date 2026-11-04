// どのサイトでも使える読み取り（page-reader.js）のテスト。本物のブラウザで見本ページを開いて確かめる。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { shortHash, LIMITS } = require('../extension/src/page-reader.js');

const READER = fs.readFileSync(path.join(__dirname, '../extension/src/page-reader.js'), 'utf8');

async function read(fixture, url, before) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 見本ページを本物の URL で開く（相対パスの画像を正しく解決させるため）。画像の読み込みは止める
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u === url) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8') });
      return route.abort();
    });
    await page.goto(url);
    if (before) await page.evaluate(before);
    await page.addScriptTag({ content: READER });
    return await page.evaluate(() => BuymaPageReader.readPage(document, location.href));
  } finally {
    await browser.close();
  }
}

test('韓国の通販サイト：JSON-LD・本文・画像の候補を取る', async () => {
  const p = await read('korean_shop.html', 'https://shop.example.kr/products/123?utm=x');
  assert.equal(p.url, 'https://shop.example.kr/products/123?utm=x');
  assert.equal(p.title, '울 롱 코트 - 데일리샵');
  assert.equal(p.metaDescription, '부드러운 울 소재의 롱 코트');
  assert.equal(p.ogImage, 'https://cdn.shop.example.kr/img/coat-main.jpg');
  assert.match(p.jsonLd, /"priceCurrency":"KRW"/);
  assert.match(p.pageText, /189,000원/);
  assert.match(p.pageText, /사이즈: S \/ M \/ L/);
  for (const bad of ['SCRIPT_TEXT', 'NAV_TEXT', 'FOOTER_TEXT', 'HEADER_TEXT', 'color:red']) {
    assert.equal(p.pageText.includes(bad), false, bad + ' が本文に入っている');
  }
  assert.deepEqual(p.images, [
    'https://cdn.shop.example.kr/img/coat-main.jpg', // og:image（JSON-LD の同じ画像は1つにまとめる）
    'https://shop.example.kr/img/coat-back.jpg', // JSON-LD の相対パス
    'https://shop.example.kr/img/coat-detail1.jpg', // 大きい画像（2回出てくるが1つに）
    'https://cdn.shop.example.kr/img/coat-detail2.jpg', // //始まり
    'https://shop.example.kr/img/coat-detail3-1200.jpg', // srcset のいちばん大きいもの
  ]);
});

test('JSON-LD のないヨーロッパの通販サイト：本文と画像だけでも取れる', async () => {
  const p = await read('eu_shop.html', 'https://boutique.example.fr/sac');
  assert.equal(p.jsonLd, '');
  assert.equal(p.metaDescription, 'Sac à main en cuir de veau');
  assert.match(p.pageText, /Prix : 249,00 €/);
  assert.equal(p.pageText.includes('NAV_TEXT'), false);
  assert.equal(p.pageText.includes('FOOTER_TEXT'), false);
  // http の画像は https にそろえる
  assert.deepEqual(p.images, ['https://images.example.fr/sac-1.jpg', 'https://images.example.fr/sac-2.jpg']);
});

test('長いページは本文を上限で切る', async () => {
  const p = await read('eu_shop.html', 'https://boutique.example.fr/long', () => {
    const div = document.createElement('div');
    div.textContent = 'あ'.repeat(40000);
    document.body.append(div);
  });
  assert.equal(p.pageText.length, LIMITS.pageText);
});

test('URL から作る目印は8文字で、?以降が違っても同じ', () => {
  const a = shortHash('https://boutique.example.fr/sac?ref=ad1');
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, shortHash('https://boutique.example.fr/sac?ref=ad2'));
  assert.notEqual(a, shortHash('https://boutique.example.fr/sac-2'));
});
