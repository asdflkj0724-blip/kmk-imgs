const api = BuymaApi.createApi();
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await api.getSettings();
  $('apiBase').value = s.apiBase;
  $('mode').value = s.mode;
  $('intervalSec').value = s.intervalSec;
  $('imageMaxPx').value = s.imageMaxPx;
  $('jpegQuality').value = s.jpegQuality;
  const auth = await api.getAuth();
  $('auth').textContent = auth ? `ログイン中：${auth.email || '（メール不明）'}` : 'ログインしていません';
}

async function save() {
  const s = await api.saveSettings({
    apiBase: $('apiBase').value,
    mode: $('mode').value,
    intervalSec: $('intervalSec').value,
    imageMaxPx: $('imageMaxPx').value,
    jpegQuality: $('jpegQuality').value,
  });
  await load();
  $('status').textContent = '保存しました';
  return s;
}

$('save').addEventListener('click', save);
$('connect').addEventListener('click', async () => {
  const s = await save();
  chrome.tabs.create({ url: s.apiBase + '/extension/connect?ext=' + chrome.runtime.id });
});
$('logout').addEventListener('click', async () => {
  await api.logout();
  await load();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.auth) load();
});
load();
