const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApi, normalizeSettings } = require('../extension/src/api.js');

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k), m };
}
function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const NOW = 1_800_000_000_000;

test('401 が返ったら1回だけトークンを更新してやり直す', async () => {
  const storage = memoryStorage({ auth: { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW / 1000 + 3600 } });
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push([url, opts.headers.authorization || JSON.parse(opts.body).refreshToken]);
    if (url.endsWith('/api/ext/refresh')) return res(200, { accessToken: 'new', refreshToken: 'r2', expiresAt: NOW / 1000 + 3600 });
    return opts.headers.authorization === 'Bearer new' ? res(200, { email: 'a@example.com' }) : res(401, {});
  };
  const api = createApi({ storage, fetch, now: () => NOW });
  assert.deepEqual(await api.me(), { email: 'a@example.com' });
  assert.deepEqual(calls.map((c) => c[1]), ['Bearer old', 'r1', 'Bearer new']);
  assert.equal(storage.m.get('auth').refreshToken, 'r2');
});

test('期限が近ければ先に更新する', async () => {
  const storage = memoryStorage({ auth: { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW / 1000 + 30 } });
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push(url.replace('http://localhost:3000', ''));
    if (url.endsWith('/api/ext/refresh')) return res(200, { accessToken: 'new', refreshToken: 'r2', expiresAt: NOW / 1000 + 3600 });
    return res(200, { product: { title: 'x' } });
  };
  const api = createApi({ storage, fetch, now: () => NOW });
  await api.extract({ url: 'https://shop.example/p/1', pageText: '...' });
  assert.deepEqual(seen, ['/api/ext/refresh', '/api/extract']);
});

test('上限に達したときは、サーバーの説明をそのままエラーにする', async () => {
  const storage = memoryStorage({ auth: { accessToken: 'a', refreshToken: 'r', expiresAt: NOW / 1000 + 3600 } });
  const fetch = async () => res(402, { error: '今月の上限に達しました。', allowance: { remaining: 0 } });
  const api = createApi({ storage, fetch, now: () => NOW });
  await assert.rejects(api.generate({}), (e) => e.status === 402 && e.message === '今月の上限に達しました。');
});

test('更新もできなければログアウトする', async () => {
  const storage = memoryStorage({ auth: { accessToken: 'a', refreshToken: 'r', expiresAt: NOW / 1000 + 3600 } });
  const fetch = async (url) => (url.endsWith('/api/ext/refresh') ? res(401, { error: 'expired' }) : res(401, {}));
  const api = createApi({ storage, fetch, now: () => NOW });
  await assert.rejects(api.me(), (e) => e.status === 401);
  assert.equal(storage.m.get('auth'), undefined);
});

test('設定の値は安全な範囲に直し、使わなくなった設定（自動入力）は捨てる', () => {
  const s = normalizeSettings({ apiBase: 'https://x.vercel.app/', intervalSec: 5, mode: 'draft', jpegQuality: 3, imageMaxPx: 10 });
  assert.equal(s.apiBase, 'https://x.vercel.app');
  assert.equal(s.jpegQuality, 0.9);
  assert.equal(s.imageMaxPx, 300);
  assert.equal('mode' in s, false);
  assert.equal('intervalSec' in s, false);
});

test('解約した人には新しいトークンが出ないので、ログアウトして理由を見せる', async () => {
  const storage = memoryStorage({ auth: { accessToken: 'a', refreshToken: 'r', expiresAt: NOW / 1000 + 10 } });
  const fetch = async (url) =>
    url.endsWith('/api/ext/refresh') ? res(402, { error: 'プランのお申し込みをお願いします。' }) : res(200, {});
  const api = createApi({ storage, fetch, now: () => NOW });
  await assert.rejects(api.me(), (e) => e.status === 402 && e.message === 'プランのお申し込みをお願いします。');
  assert.equal(storage.m.get('auth'), undefined);
});
