// 画像の切り分け：縦長の画像（商品説明・サイズ表）を正方形にして、20枚に近づける
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const IMG = require('../extension/src/images.js');

test('切り出す範囲：人物の写真（1:2まで）は切らない。とても長い画像だけ、白い帯で切り分ける', () => {
  assert.deepEqual(IMG.tilePlan(800, 800), [{ sx: 0, sy: 0, sw: 800, sh: 800 }]);
  assert.deepEqual(IMG.tilePlan(750, 1125), [{ sx: 0, sy: 0, sw: 750, sh: 1125 }]); // 2:3 の着用写真
  assert.deepEqual(IMG.tilePlan(750, 1500), [{ sx: 0, sy: 0, sw: 750, sh: 1500 }]); // 1:2 までは切らない
  // 白い帯の情報がなければ、幅と同じ高さで切る
  assert.deepEqual(IMG.tilePlan(750, 2000).map((t) => [t.sy, t.sh]), [[0, 750], [750, 750], [1500, 500]]);
  assert.equal(IMG.tilePlan(750, 20000, 4).length, 4); // 1枚から切り出すのは4枚まで
  // 900px のところに白い帯があれば、そこで切る（写っているものの途中で切らない）
  const rows = Array.from({ length: 400 }, (_, i) => (Math.abs(i * (3000 / 400) - 900) < 10 ? 0 : 50));
  assert.ok(Math.abs(IMG.tilePlan(750, 3000, 4, rows)[0].sh - 900) <= 15);
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
      const tall = await make(750, 2250, stripes); // とても長い → 3枚に切り分け
      const photo = await make(750, 1125, stripes); // 着用写真（2:3）→ 切らずに1枚
      const blankBottom = await make(750, 3000, (ctx, w) => {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, w, 600); // 上だけ絵があり、残りは白いだけ → 白い部分は捨てる
      });
      const one = await BuymaImages.buildImageFiles([main, icon, tall, photo, blankBottom], '9', { maxPx: 600, limit: 20 });
      const many = await BuymaImages.buildImageFiles(Array(10).fill(tall), '9', { maxPx: 300, limit: 20 });
      return {
        n: one.files.length,
        names: one.files.map((f) => f.name),
        failed: one.failed,
        many: many.files.length,
      };
    });
    assert.equal(r.n, 1 + 3 + 1 + 1);
    assert.deepEqual(r.names, ['01', '02', '03', '04', '05', '06'].map((n) => `taobao_9_${n}.jpg`));
    assert.deepEqual(r.failed, []);
    assert.equal(r.many, 20); // 上限の20枚ちょうどまで入れる
  } finally {
    await browser.close();
  }
});

test('白いすき間で分ける：見出しは次にくっつけ、すき間のない長いものは切る', () => {
  // 幅100・高さ1000 を 1000行で表す。中身：0-150(人A) 200-215(見出し) 230-380(サイズ表) 420-1000(すき間なしの長いもの)
  const blank = Array.from({ length: 1000 }, (_, y) => !((y < 150) || (y >= 200 && y < 215) || (y >= 230 && y < 380) || y >= 420));
  const segs = IMG.segmentByGaps(100, 1000, blank, null);
  assert.deepEqual(segs[0], { sy: 0, sh: 150 }); // 人A
  assert.deepEqual(segs[1], { sy: 200, sh: 180 }); // 見出し＋サイズ表（見出しだけにならない）
  assert.ok(segs.slice(2).every((s) => s.sh <= 220)); // 長いもの（580）は幅の2.2倍以内に切る
  assert.equal(segs.slice(2).reduce((t, s) => t + s.sh, 0), 580);
});

test('実際の画像で：細かく切られた説明の画像をつなぎ直し、人やサイズ表の途中で切らない', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/images.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      // 長いポスター（幅750）：人3人（高さ1000）とサイズ表（高さ500）が、白いすき間（80）をはさんで並ぶ
      const W = 750;
      const blocks = [1000, 1000, 500, 1000];
      const H = blocks.reduce((t, b) => t + b + 80, 80);
      const poster = new OffscreenCanvas(W, H);
      const ctx = poster.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      let y = 80;
      const tops = [];
      for (const b of blocks) {
        tops.push(y);
        for (let k = 0; k < b; k += 30) {
          ctx.fillStyle = k % 60 ? '#a33' : '#333';
          ctx.fillRect(150, y + k, 450, 15);
        }
        y += b + 80;
      }
      // お店がやるように、人の途中で細かく切る（高さ900ずつ）
      const urls = [];
      for (let sy = 0; sy < H; sy += 900) {
        const h = Math.min(900, H - sy);
        const c = new OffscreenCanvas(W, h);
        c.getContext('2d').drawImage(poster, 0, sy, W, h, 0, 0, W, h);
        urls.push(URL.createObjectURL(await c.convertToBlob({ type: 'image/png' })));
      }
      const out = await BuymaImages.buildImageFiles(urls, '9', { maxPx: 300, limit: 20, descUrls: urls });
      return { pieces: urls.length, n: out.files.length, failed: out.failed };
    });
    assert.ok(r.pieces >= 5);
    assert.equal(r.n, 4, 'まとまり（人3人＋サイズ表）ごとに1枚ずつ');
    assert.deepEqual(r.failed, []);
  } finally {
    await browser.close();
  }
});

test('候補の一覧（見本つき）を作り、チェックしたものだけを本番の大きさで作り直せる', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src/images.js'), 'utf8') });
    const r = await page.evaluate(async () => {
      const W = 750;
      const blocks = [1000, 1000, 500];
      const H = blocks.reduce((t, b) => t + b + 80, 80);
      const poster = new OffscreenCanvas(W, H);
      const ctx = poster.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      let y = 80;
      for (const b of blocks) {
        for (let k = 0; k < b; k += 30) {
          ctx.fillStyle = k % 60 ? '#a33' : '#333';
          ctx.fillRect(150, y + k, 450, 15);
        }
        y += b + 80;
      }
      const urls = [];
      for (let sy = 0; sy < H; sy += 900) {
        const h = Math.min(900, H - sy);
        const c = new OffscreenCanvas(W, h);
        c.getContext('2d').drawImage(poster, 0, sy, W, h, 0, 0, W, h);
        urls.push(URL.createObjectURL(await c.convertToBlob({ type: 'image/png' })));
      }
      const plan = await BuymaImages.planImages(urls, { descUrls: urls, limit: 30, thumbPx: 80 });
      const chosen = plan.items.filter((_, i) => i !== 1); // 2番目を使わない
      const out = await BuymaImages.renderPlan(chosen, '9', { maxPx: 300 });
      const bmp = await createImageBitmap(new Blob([out.files[0].data], { type: 'image/jpeg' }));
      return {
        planned: plan.items.length,
        thumbs: plan.items.every((x) => x.thumb.startsWith('data:image/jpeg;base64,')),
        rendered: out.files.map((f) => f.name),
        size: [bmp.width, bmp.height],
        failed: out.failed,
      };
    });
    assert.equal(r.planned, 3);
    assert.ok(r.thumbs);
    assert.deepEqual(r.rendered, ['taobao_9_01.jpg', 'taobao_9_02.jpg']);
    assert.deepEqual(r.size, [300, 300]);
    assert.deepEqual(r.failed, []);
  } finally {
    await browser.close();
  }
});
