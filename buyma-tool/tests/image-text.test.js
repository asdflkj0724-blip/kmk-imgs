// 画像の中の外国語を日本語に：読み取り（拡張機能の中で動くか）・書き換え・訳す行の選び方
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const T = require('../extension/src/image-text.js');

test('訳す行の選び方：中国語・英単語は訳す。サイズ・数字・日本語・ロゴのような読み取りは訳さない', () => {
  assert.equal(T.cleanOcrText('衣 长 胸围 肩 宽'), '衣长胸围肩宽');
  assert.equal(T.cleanOcrText('“胸围'), '胸围');
  assert.equal(T.needsTranslation('衣长', 92), true);
  assert.equal(T.needsTranslation('胸围', 37), true); // 漢字は自信が低めでも拾う
  assert.equal(T.needsTranslation('S 58 110 50 60', 92), false);
  assert.equal(T.needsTranslation('XL 120cm', 90), false);
  assert.equal(T.needsTranslation('サイズ表', 90), false);
  assert.equal(T.needsTranslation('mamcC', 56), false);
  assert.equal(T.needsTranslation('New Arrival', 90), true);
});

test('表の列ごとに区切る：大きくあいたところで分ける', () => {
  const w = (text, x0, x1) => ({ text, confidence: 90, bbox: { x0, y0: 0, x1, y1: 30 } });
  const chunks = T.splitByGaps({ text: '衣长 胸围', bbox: { x0: 0, y0: 0, x1: 300, y1: 30 }, words: [w('衣', 0, 30), w('长', 32, 62), w('胸', 200, 230), w('围', 232, 262)] });
  assert.deepEqual(chunks.map((c) => c.text), ['衣长', '胸围']);
  assert.deepEqual(chunks[1].bbox, { x0: 200, y0: 0, x1: 262, y1: 30 });
});

test('拡張機能の中で：画像の中国語を読み取り、日本語に書き換えた画像を作れる', async () => {
  const ext = path.join(__dirname, '..', 'extension');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raku-ocr-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: 'chromium', // 拡張機能を読み込める通常版
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    const r = await page.evaluate(async () => {
      const c = new OffscreenCanvas(750, 300);
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 750, 300);
      x.fillStyle = '#222';
      x.font = '34px "WenQuanYi Zen Hei", sans-serif';
      x.fillText('尺码表', 40, 70);
      x.font = '30px "WenQuanYi Zen Hei", sans-serif';
      x.fillText('衣长', 40, 170);
      x.fillText('胸围', 260, 170);
      x.fillText('袖长', 480, 170);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const ocr = await RakuImageText.createOcr(chrome.runtime.getURL(''));
      const plan = [{ parts: [url], stitched: false, crop: null, thumb: '' }];
      await BuymaImages.ocrPlan(plan, (cv) => ocr.recognize(cv));
      await ocr.terminate();
      const found = plan[0].ocr.filter((l) => RakuImageText.needsTranslation(l.text, l.confidence)).map((l) => l.text);
      // 訳したことにして、書き換えた画像を作る（翻訳はサーバーの役目なので、ここでは決まった訳を使う）
      const dict = { 尺码表: 'サイズ表', 衣长: '着丈', 胸围: 'バスト', 袖长: '袖丈' };
      plan[0].texts = plan[0].ocr.filter((l) => dict[l.text]).map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, ja: dict[l.text] }));
      const before = await BuymaImages.renderPlan([{ ...plan[0], translate: false }], 't', { maxPx: 400 });
      const after = await BuymaImages.renderPlan(plan, 't', { maxPx: 400 });
      const same = before.files[0].data.length === after.files[0].data.length && before.files[0].data.every((v, i) => v === after.files[0].data[i]);
      return { found, painted: plan[0].texts.length, changed: !same };
    });
    assert.deepEqual(errors, []);
    for (const w of ['衣长', '胸围', '袖长']) assert.ok(r.found.includes(w), `${w} を読み取れる（読み取り：${r.found.join('・')}）`);
    assert.ok(r.painted >= 3);
    assert.equal(r.changed, true, '書き換えた画像は元と違う');
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
