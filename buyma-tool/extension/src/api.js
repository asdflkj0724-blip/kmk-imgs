/*
 * サーバー（管理画面と同じサイト）の API を呼ぶ小さな道具。
 * ポップアップ・設定画面・バックグラウンドのどれからでも使える（DOM を使わない）。
 * ログイン情報（トークン）は chrome.storage.local に保存し、期限が近ければ自動で更新する。
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    apiBase: 'http://localhost:3000',
    imageMaxPx: 1200,
    jpegQuality: 0.9,
  };

  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body || null;
    }
  }

  function chromeStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
    return {
      get: (key) => chrome.storage.local.get(key).then((o) => o[key]),
      set: (key, value) => chrome.storage.local.set({ [key]: value }),
      remove: (key) => chrome.storage.local.remove(key),
    };
  }

  function normalizeSettings(s) {
    const src = s || {};
    const out = {
      apiBase: String(src.apiBase || DEFAULT_SETTINGS.apiBase).trim().replace(/\/+$/, ''),
      imageMaxPx: src.imageMaxPx,
      jpegQuality: src.jpegQuality,
    };
    out.imageMaxPx = Math.min(4000, Math.max(300, Math.round(Number(out.imageMaxPx) || DEFAULT_SETTINGS.imageMaxPx)));
    const q = Number(out.jpegQuality);
    out.jpegQuality = q > 0 && q <= 1 ? q : DEFAULT_SETTINGS.jpegQuality;
    return out;
  }

  function messageFor(status, body) {
    if (body && typeof body.error === 'string' && body.error) return body.error;
    if (status === 401) return 'ログインが切れました。設定画面から「ログインして連携する」をもう一度行ってください。';
    if (status === 402) return (body && body.allowance && body.allowance.reason) || '今月の上限に達しました。';
    if (status === 400) return '送った内容に問題がありました。';
    if (status >= 500) return 'サーバーでエラーが起きました。少し待ってからもう一度お試しください。';
    return `エラーが起きました（${status}）`;
  }

  function createApi(deps) {
    deps = deps || {};
    const storage = deps.storage || chromeStorage();
    const fetchImpl = deps.fetch || ((...a) => fetch(...a));
    const now = deps.now || (() => Date.now());
    if (!storage) throw new Error('storage がありません');

    async function getSettings() {
      return normalizeSettings(await storage.get('settings'));
    }
    async function saveSettings(s) {
      const merged = normalizeSettings(Object.assign({}, await storage.get('settings'), s));
      await storage.set('settings', merged);
      return merged;
    }
    async function getAuth() {
      return (await storage.get('auth')) || null;
    }
    async function setAuth(auth) {
      if (!auth) return storage.remove('auth');
      return storage.set('auth', {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: Number(auth.expiresAt) || 0,
        email: auth.email || '',
      });
    }
    async function logout() {
      await storage.remove('auth');
    }

    async function refresh() {
      const auth = await getAuth();
      if (!auth || !auth.refreshToken) throw new ApiError(messageFor(401), 401);
      const { apiBase } = await getSettings();
      let res;
      try {
        res = await fetchImpl(apiBase + '/api/ext/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
        });
      } catch (e) {
        throw new ApiError('サーバーにつながりませんでした。設定画面のサーバーURLを確認してください。', 0);
      }
      const body = await res.json().catch(() => null);
      if (res.status === 402) {
        // 解約・支払い停止・お試し終了：サーバーが新しいトークンを出さないので、ログアウトして理由を見せる
        await logout();
        throw new ApiError((body && body.error) || messageFor(402), 402, body);
      }
      if (!res.ok || !body || !body.accessToken) {
        if (res.status === 401 || res.status === 400) await logout();
        throw new ApiError(messageFor(401), 401, body);
      }
      const next = Object.assign({}, auth, body);
      await setAuth(next);
      return next;
    }

    async function validToken() {
      let auth = await getAuth();
      if (!auth || !auth.accessToken) throw new ApiError('ログインしていません。設定画面から「ログインして連携する」を行ってください。', 401);
      if (auth.expiresAt && auth.expiresAt * 1000 - now() < 60_000) auth = await refresh();
      return auth.accessToken;
    }

    async function request(path, opts) {
      opts = opts || {};
      const { apiBase } = await getSettings();
      const send = async (token) => {
        const headers = { authorization: 'Bearer ' + token };
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        try {
          return await fetchImpl(apiBase + path, {
            method: opts.method || 'GET',
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          });
        } catch (e) {
          throw new ApiError('サーバーにつながりませんでした。設定画面のサーバーURLを確認してください。', 0);
        }
      };
      let res = await send(await validToken());
      if (res.status === 401) {
        const auth = await refresh(); // 1回だけ更新してやり直す
        res = await send(auth.accessToken);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(messageFor(res.status, body), res.status, body);
      return body;
    }

    return {
      getSettings,
      saveSettings,
      getAuth,
      setAuth,
      logout,
      refresh,
      request,
      me: () => request('/api/me'),
      generate: (product, templateId, instruction) =>
        request('/api/generate', { method: 'POST', body: { product, templateId: templateId || undefined, instruction: instruction || undefined } }),
      // どのサイトでも：ページの中身から AI が商品情報を抜き出す
      extract: (page) => request('/api/extract', { method: 'POST', body: { page } }),
      vision: (imageBase64, mediaType, url) => request('/api/vision', { method: 'POST', body: { imageBase64, mediaType, url } }),
      updateListing: (id, patch) => request('/api/listings/' + encodeURIComponent(id), { method: 'PATCH', body: patch }),
    };
  }

  const api = { createApi, ApiError, DEFAULT_SETTINGS, normalizeSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
