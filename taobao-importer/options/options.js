/**
 * options.js
 * ============================================================
 * 設定画面の動き。
 * 為替レート・送料・利益率・丸め単位・管理番号・SNSテンプレートを
 * chrome.storage.local に保存します。
 * ============================================================
 */

function $(id) {
  return document.getElementById(id);
}

/** 保存済みの設定値を画面に反映する */
async function loadIntoForm() {
  const data = await dbLoad();
  const s = data.settings;
  $('s-rate').value = s.exchangeRate;
  $('s-shipping').value = s.shippingJpy;
  $('s-profit').value = s.profitRate;
  $('s-round').value = s.roundUnit;
  $('s-prefix').value = s.codePrefix;
  $('s-digits').value = s.codeDigits;
  $('s-template').value = data.snsTemplate;
  updatePreview();
}

/** 画面の入力値から設定オブジェクトを作る */
function settingsFromForm() {
  return {
    exchangeRate: parseFloat($('s-rate').value) || 0,
    shippingJpy: parseFloat($('s-shipping').value) || 0,
    profitRate: parseFloat($('s-profit').value) || 0,
    roundUnit: parseInt($('s-round').value, 10) || 1,
    codePrefix: $('s-prefix').value.trim() || 'MAMC',
    codeDigits: parseInt($('s-digits').value, 10) || 6
  };
}

/** 「100元ならいくらになるか」のプレビューを表示 */
function updatePreview() {
  const s = settingsFromForm();
  const sample = 100;
  const result = calculateSellingPrice(sample, s);
  $('price-preview').textContent =
    'プレビュー：' + sample + '元の商品 → 販売価格 ' + formatJpy(result);
}

function showMessage(text, isError) {
  const el = $('message');
  el.textContent = text;
  el.className = 'message' + (isError ? ' error' : '');
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2500);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadIntoForm();

    // 数値を変えるたびにプレビューを更新
    for (const id of ['s-rate', 's-shipping', 's-profit', 's-round']) {
      $(id).addEventListener('input', updatePreview);
    }

    $('btn-save').addEventListener('click', async () => {
      try {
        await saveSettings(settingsFromForm());
        await saveSnsTemplate($('s-template').value);
        showMessage('保存しました。次の取り込みから反映されます。');
      } catch (e) {
        console.error('[MAMC取り込み] 設定の保存に失敗:', e);
        showMessage('保存に失敗しました: ' + e.message, true);
      }
    });

    $('btn-reset').addEventListener('click', async () => {
      if (!confirm('設定とSNSテンプレートを初期値に戻しますか？')) return;
      await saveSettings(DEFAULT_SETTINGS);
      await saveSnsTemplate(DEFAULT_SNS_TEMPLATE);
      await loadIntoForm();
      showMessage('初期値に戻しました。');
    });
  } catch (e) {
    console.error('[MAMC取り込み] 設定画面の初期化に失敗:', e);
    showMessage('設定画面の初期化に失敗しました: ' + e.message, true);
  }
});
