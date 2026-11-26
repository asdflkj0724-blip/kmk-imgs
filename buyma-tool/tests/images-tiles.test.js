// 画像の切り分け：縦長の画像（商品説明・サイズ表）を正方形にして、20枚に近づける
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const IMG = require('../extension/src/images.js');

test('切り出す範囲：縦長は幅と同じ高さで上から切り分け、小さな切れ端は捨てる', () => {
  assert.deepEqual(IMG.tilePlan(800, 800), [{ sx: 0, sy: 0, sw: 800, sh: 800 }]);
  assert.deepEqual(IMG.tilePlan(800, 1000), [{ sx: 0, sy: 0, sw: 800, sh: 1000 }]); // 少し縦長なら1枚
  assert.deepEqual(
    IMG.tilePlan(750, 2000).map((t) => [t.sy, t.sh]),
    [[0, 750], [750, 750], [1500, 500]]
  );
  assert.deepEqual(IMG.tilePlan(750, 1600).map((t) => t.sy), [0, 750]); // 残り100pxは捨てる
  assert.equal(IMG.tilePlan(750, 20000, 4).length, 4); // 1枚から切り出すのは4枚まで
});

test('ほぼ一色（白いだけ）の部分を見分ける', () => {
  const white = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  assert.equal(IMG.isBlankPixels(white), true);
  const mixed = new Uint8ClampedArray(white);
  for (let i = 0; i < mixed.length / 2; i += 4) mixed[i] = mixed[i + 1] = mixed[i + 2] = 0;
  assert.equal(IMG.isBlankPixels(mixed), false);
});

test('実際の画像で：メイン画像＋縦長の説明画像を切り分けて、20枚までに収める', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/images.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      async function make(w, h, draw) {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        draw(ctx, w, h);
        const b = await c.convertToBlob({ type: 'image/png' });
        return URL.createObjectURL(b);
      }
      const stripes = (ctx, w, h) => {
        for (let y = 0; y < h; y += 40) {
          ctx.fillStyle = y % 80 ? '#333' : '#c33';
          ctx.fillRect(0, y, w, 20);
        }
      };
      const main = await make(800, 800, stripes);
      const icon = await make(40, 40, stripes); // 小さいので使わない
      const tall = await make(750, 2250, stripes); // 3枚に切り分け
      const blankBottom = await make(750, 1500, (ctx, w) => {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, w, 600); // 下半分は白いだけ → 2枚目は捨てる
      });
      const one = await BuymaImages.buildImageFiles([main, icon, tall, blankBottom], '9', { maxPx: 600, limit: 20 });
      const many = await BuymaImages.buildImageFiles(Array(10).fill(tall), '9', { maxPx: 300, limit: 20 });
      return {
        n: one.files.length,
        names: one.files.map((f) => f.name),
        failed: one.failed,
        many: many.files.length,
      };
    });
    assert.equal(r.n, 1 + 3 + 1);
    assert.deepEqual(r.names, ['taobao_9_01.jpg', 'taobao_9_02.jpg', 'taobao_9_03.jpg', 'taobao_9_04.jpg', 'taobao_9_05.jpg']);
    assert.deepEqual(r.failed, []);
    assert.equal(r.many, 20); // 上限の20枚ちょうどまで入れる
  } finally {
    await browser.close();
  }
});
