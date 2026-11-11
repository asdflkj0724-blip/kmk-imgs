/*
 * バックグラウンド：サイトの「ログインして連携する」ページからログイン情報を受け取るだけ。
 * BUYMA の画面を自動で操作することはしない（BUYMA 会員規約 第8条）。
 */
importScripts('src/api.js');

const api = BuymaApi.createApi();

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return '';
  }
}

// ログイン連携は、設定画面で決めたサーバー（apiBase）からだけ受け付ける。
// 外からのメッセージで送り先のサーバーを書き換えられないようにするため。
async function isAllowedOrigin(origin) {
  if (!origin) return false;
  const { apiBase } = await api.getSettings();
  const saved = originOf(apiBase);
  return saved === origin && (origin.startsWith('https://') || origin === 'http://localhost:3000');
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.type !== 'BUYMA_AUTH' || !msg.accessToken || !msg.refreshToken) {
      return sendResponse({ ok: false, error: 'invalid message' });
    }
    const senderOrigin = sender.origin || originOf(sender.url);
    const claimed = originOf(msg.apiBase);
    if (!claimed || senderOrigin !== claimed || !(await isAllowedOrigin(senderOrigin))) {
      return sendResponse({ ok: false, error: 'origin not allowed' });
    }
    await api.setAuth({
      accessToken: msg.accessToken,
      refreshToken: msg.refreshToken,
      expiresAt: msg.expiresAt,
      email: msg.email,
    });
    sendResponse({ ok: true });
  })();
  return true;
});
