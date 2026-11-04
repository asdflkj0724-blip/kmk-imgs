/*
 * バックグラウンド：
 *  1. サイトの「ログインして連携する」ページからログイン情報を受け取る
 *  2. 「出品待ち」を1件ずつ BUYMA の出品画面に入力する（同時に開くタブは1つだけ）
 */
importScripts('src/api.js', 'src/buyma-config.js');

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

// ---- 出品待ちの順番入力 ----
// 状態は chrome.storage.session に置く（バックグラウンドが止まっても続きから動く）

const FILL_TIMEOUT_SEC = 90;

async function getQueue() {
  return (await chrome.storage.session.get('queue')).queue || { running: false, items: [], index: 0, log: [] };
}
async function setQueue(q) {
  await chrome.storage.session.set({ queue: q });
  return q;
}
function log(q, text) {
  q.log = [...(q.log || []), `${new Date().toLocaleTimeString('ja-JP')} ${text}`].slice(-30);
}

async function startQueue() {
  const q0 = await getQueue();
  if (q0.running) return q0;
  // 使えるアカウントか、サーバーで確かめてから始める（だめなら api.listings も 402 で止まる）
  const me = await api.me();
  if (me.active !== true) throw new Error(me.inactiveReason || 'このアカウントでは使えません');
  const { listings } = await api.listings('queued', 50);
  const q = { running: true, items: listings || [], index: 0, tabId: null, phase: 'idle', log: [], done: 0, failed: 0 };
  log(q, `${q.items.length}件を順番に入力します`);
  if (!q.items.length) {
    q.running = false;
    log(q, '出品待ちはありません');
  }
  await setQueue(q);
  if (q.running) await openNext();
  return getQueue();
}

async function stopQueue(reason) {
  const q = await getQueue();
  q.running = false;
  q.phase = 'idle';
  log(q, reason || '止めました');
  await chrome.alarms.clear('buyma-next');
  await chrome.alarms.clear('buyma-timeout');
  return setQueue(q);
}

async function openNext() {
  const q = await getQueue();
  if (!q.running) return;
  if (q.index >= q.items.length) {
    q.running = false;
    q.phase = 'idle';
    log(q, `終わりました（入力 ${q.done}件・失敗 ${q.failed}件）`);
    return setQueue(q);
  }
  const item = q.items[q.index];
  let tab = null;
  if (q.tabId != null) {
    tab = await chrome.tabs.update(q.tabId, { url: BuymaConfig.newListingUrl, active: true }).catch(() => null);
  }
  if (!tab) tab = await chrome.tabs.create({ url: BuymaConfig.newListingUrl, active: true });
  q.tabId = tab.id;
  q.phase = 'filling';
  log(q, `${q.index + 1}/${q.items.length}「${(item.title_ja || '').slice(0, 20)}」を入力中`);
  await setQueue(q);
  chrome.alarms.create('buyma-timeout', { delayInMinutes: FILL_TIMEOUT_SEC / 60 });
}

async function finishCurrent(result, pageUrl) {
  const q = await getQueue();
  if (!q.running || q.phase !== 'filling') return;
  const item = q.items[q.index];
  await chrome.alarms.clear('buyma-timeout');
  const ok = result && result.ok;
  const note = ok
    ? result.draftClicked
      ? '下書き保存のボタンを押しました'
      : 'BUYMA に入力しました（保存は手動）'
    : '見つからなかった項目：' + ((result && result.missing) || []).join('、') + (result && result.error ? ` / ${result.error}` : '');
  try {
    await api.updateListing(item.id, { status: ok ? 'filled' : 'failed', statusNote: note, buymaUrl: pageUrl || undefined });
  } catch (e) {
    log(q, `状態の保存に失敗：${e.message}`);
  }
  if (ok) q.done++;
  else q.failed++;
  log(q, ok ? '入力しました' : `失敗：${note}`);
  q.index++;
  q.phase = 'waiting';
  await setQueue(q);
  if (q.index >= q.items.length) return openNext();
  const { intervalSec } = await api.getSettings(); // 30秒以上（BUYMA に負担をかけないため）
  chrome.alarms.create('buyma-next', { delayInMinutes: Math.max(BuymaApi.MIN_INTERVAL_SEC, intervalSec) / 60 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'buyma-next') await openNext();
  if (alarm.name === 'buyma-timeout') await finishCurrent({ ok: false, missing: [], error: '時間内に入力できませんでした' });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const q = await getQueue();
  if (q.running && q.tabId === tabId) await stopQueue('入力用のタブが閉じられたので止めました');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'QUEUE_START':
          return sendResponse({ ok: true, queue: await startQueue() });
        case 'QUEUE_STOP':
          return sendResponse({ ok: true, queue: await stopQueue() });
        case 'QUEUE_STATUS':
          return sendResponse({ ok: true, queue: await getQueue() });
        case 'BUYMA_FILL_GET': {
          // 順番入力で開いたタブにだけ、入力するデータを渡す
          const q = await getQueue();
          const item = q.running && q.phase === 'filling' && sender.tab && sender.tab.id === q.tabId ? q.items[q.index] : null;
          const { mode } = await api.getSettings();
          return sendResponse({ listing: item, mode });
        }
        case 'BUYMA_FILL_RESULT': {
          const q = await getQueue();
          if (sender.tab && sender.tab.id === q.tabId && q.items[q.index] && q.items[q.index].id === msg.listingId) {
            await finishCurrent(msg.result, msg.pageUrl);
          }
          return sendResponse({ ok: true });
        }
        default:
          return sendResponse({ ok: false });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});
