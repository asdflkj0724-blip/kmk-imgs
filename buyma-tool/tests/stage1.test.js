// 段階1：配送方法の引き継ぎ・お知らせの整理・正方形の画像と透かし
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { normalizeSettings } = require('../extension/src/api.js');
const PF = require('../extension/src/product-form.js');
const IMG = require('../extension/src/images.js');

test('配送方法は一言一句そのまま保存し、重複と空行だけを除く', () => {
  const s = normalizeSettings({
    shippingMethods: ['OCS（追跡あり） ', 'ゆうパケット\r', '', '   ', 'OCS（追跡あり） ', 'クロネコ 宅急便'],
    lastShipping: 'ゆうパケット',
  });
  assert.deepEqual(s.shippingMethods, ['OCS（追跡あり） ', 'ゆうパケット', 'クロネコ 宅急便']);
  assert.equal(s.lastShipping, 'ゆうパケット');
});

test('最後に選んだ配送方法が一覧から消えたら、引き継がない', () => {
  assert.equal(normalizeSettings({ shippingMethods: ['A'], lastShipping: 'B' }).lastShipping, '');
});

test('透かしの設定を保存する', () => {
  const s = normalizeSettings({ watermarkEnabled: true, watermarkText: 'MAMC\nshop' });
  assert.equal(s.watermarkEnabled, true);
  assert.equal(s.watermarkText, 'MAMC shop');
  assert.equal(normalizeSettings({}).watermarkEnabled, false);
});

test('配送方法の初めの選択：最後に選んだもの → 名前が完全に同じサーバーの設定 → 未選択', () => {
  const list = ['メール便', '宅急便'];
  assert.equal(PF.pickShipping(list, '宅急便', 'メール便'), '宅急便');
  assert.equal(PF.pickShipping(list, '', 'メール便'), 'メール便');
  assert.equal(PF.pickShipping(list, '', 'メール便（追跡）'), ''); // 名前が違えば勝手に選ばない
  assert.equal(PF.pickShipping([], '宅急便', ''), '');
});

test('1→5商品目の配送方法の引き継ぎ', () => {
  let saved = normalizeSettings({ shippingMethods: ['メール便', '宅急便'] });
  const picks = [];
  const choose = (v) => (saved = normalizeSettings({ ...saved, lastShipping: v }));
  choose('メール便'); picks.push(PF.pickShipping(saved.shippingMethods, saved.lastShipping, ''));
  picks.push(PF.pickShipping(saved.shippingMethods, saved.lastShipping, ''));
  picks.push(PF.pickShipping(saved.shippingMethods, saved.lastShipping, ''));
  choose('宅急便'); picks.push(PF.pickShipping(saved.shippingMethods, saved.lastShipping, ''));
  picks.push(PF.pickShipping(saved.shippingMethods, saved.lastShipping, ''));
  assert.deepEqual(picks, ['メール便', 'メール便', 'メール便', '宅急便', '宅急便']);
});

test('お知らせは 要修正 → 確認 → 参考 → 自動で直した の順に並べる', () => {
  const items = PF.noticeItems({
    fixes: ['根拠のない表現（「高級」）を自動で消しました'],
    missing: ['素材', 'サイズの実寸'],
    cautions: ['性別が決められません'],
    issues: [{ level: 'error', message: '「スーパーコピー」は使えません' }],
  });
  assert.deepEqual(items.map((i) => i.level), ['error', 'warning', 'info', 'fixed']);
  assert.equal(items[2].text, '【ページに情報がなかった項目】素材・サイズの実寸');
});

test('正方形の置き方：比率を保ち、引き伸ばさない', () => {
  assert.deepEqual(IMG.squareLayout(400, 200, 300), { side: 300, dw: 300, dh: 150, dx: 0, dy: 75 });
  assert.deepEqual(IMG.squareLayout(200, 800, 1200), { side: 800, dw: 200, dh: 800, dx: 300, dy: 0 });
  assert.deepEqual(IMG.squareLayout(100, 100, 1200), { side: 100, dw: 100, dh: 100, dx: 0, dy: 0 });
});

test('本物のブラウザで：横長の画像が白い余白付きの正方形になり、透かしが右下寄りに入る', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    for (const f of ['zip.js', 'images.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../extension/src', f), 'utf8') });
    }
    const r = await page.evaluate(async () => {
      // 400×200 の赤い画像
      const c = new OffscreenCanvas(400, 200);
      const g = c.getContext('2d');
      g.fillStyle = '#ff0000';
      g.fillRect(0, 0, 400, 200);
      const url = URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
      const out = {};
      for (const wm of ['', 'MAMC']) {
        const { zip, ok } = await BuymaImages.buildImagesZip([url], 'x', { maxPx: 300, quality: 0.95, watermark: wm });
        // STORE の ZIP なので、ローカルヘッダの後ろにそのまま JPEG が入っている
        const dv = new DataView(zip.buffer);
        const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
        const size = dv.getUint32(18, true);
        const bmp = await createImageBitmap(new Blob([zip.slice(start, start + size)], { type: 'image/jpeg' }));
        const k = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
        k.drawImage(bmp, 0, 0);
        const px = (x, y) => Array.from(k.getImageData(x, y, 1, 1).data.slice(0, 3));
        // 透かしのあたり（右下寄り。正方形の右から12%・下から12%）で、白から変わった画素の数
        let changed = 0;
        for (let x = 200; x < 264; x++) for (let y = 248; y < 266; y++) {
          if (px(x, y).some((c) => c < 235)) changed++;
        }
        out[wm || 'none'] = { ok, w: bmp.width, h: bmp.height, top: px(150, 20), center: px(150, 150), bottomPad: px(150, 290), changed };
      }
      return out;
    });
    for (const v of Object.values(r)) {
      assert.equal(v.ok, 1);
      assert.equal(v.w, 300);
      assert.equal(v.h, 300);
      assert.ok(v.top.every((c) => c > 240), '上の余白は白');
      assert.ok(v.bottomPad.every((c) => c > 240), '下の余白は白');
      assert.ok(v.center[0] > 200 && v.center[1] < 60, '真ん中は商品（赤）のまま');
    }
    assert.equal(r.none.changed, 0, '透かしなしなら変わらない');
    assert.ok(r.MAMC.changed > 20, '透かしありなら右下寄りに文字が入る');
  } finally {
    await browser.close();
  }
});

test('タイトルの文字数は BUYMA と同じ数え方（半角1・全角2）', () => {
  assert.equal(PF.buymaLength('ABC'), 3);
  assert.equal(PF.buymaLength('ウール'), 6);
  assert.equal(PF.buymaLength('あ'.repeat(30)), 60);
});
