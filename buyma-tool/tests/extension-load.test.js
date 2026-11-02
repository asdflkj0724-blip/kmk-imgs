// 拡張機能を本物の Chromium に読み込んで、manifest の誤りで読み込めない、ということがないか確かめる
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

test('拡張機能を読み込める（バックグラウンドが起動し、各画面が開ける）', async () => {
  const ext = path.join(__dirname, '../extension');
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-profile-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true,
    channel: 'chromium', // 簡易版のヘッドレスブラウザは拡張機能を読み込めないため、通常版を使う
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const id = new URL(sw.url()).host;
    assert.match(id, /^[a-p]{32}$/);
    const errors = [];
    for (const page of ['popup.html', 'options.html']) {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${page}: ${e.message}`));
      await p.goto(`chrome-extension://${id}/${page}`);
      await p.waitForTimeout(300);
      await p.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
