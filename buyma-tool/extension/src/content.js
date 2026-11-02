// ポップアップから頼まれたら、今開いているページを読んで結果を返す
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'EXTRACT_PRODUCT') {
    try {
      sendResponse({ ok: true, product: BuymaExtractor.extractProduct(document, location.href) });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  }
  return false;
});
