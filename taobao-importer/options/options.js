/**
 * options.js
 * ============================================================
 * 設定画面の動きを担当します。
 *
 * ・価格計算の数値(為替レート・送料・利益・端数単位)
 * ・管理番号の先頭文字
 * ・SNS投稿文テンプレート
 *
 * 保存先は chrome.storage.local(lib/storage.js 経由)。
 * ============================================================
 */

'use strict';

function $(id) { return document.getElementById(id); }

function setStatus(message, type) {
  var el = $('status');
  if (!message) { el.hidden = true; return; }
  el.textContent = message;
  el.className = 'status ' + (type || 'success');
  el.hidden = false;
}

/** 保存済み設定を画面に反映 */
async function loadForm() {
  var settings = await getSettings();
  $('s-exchange-rate').value = settings.price.exchangeRate;
  $('s-shipping').value = settings.price.shippingJpy;
  $('s-profit').value = settings.price.profitJpy;
  $('s-round-unit').value = settings.price.roundUnit;
  $('s-number-prefix').value = settings.numberPrefix;
  $('s-sns-template').value = settings.snsTemplate;
}

/** 画面の内容を保存 */
async function saveForm() {
  try {
    var exchangeRate = parseFloat($('s-exchange-rate').value);
    var shipping = parseFloat($('s-shipping').value);
    var profit = parseFloat($('s-profit').value);
    var roundUnit = parseInt($('s-round-unit').value, 10);

    if (!isFinite(exchangeRate) || exchangeRate <= 0) {
      setStatus('為替レートには 0 より大きい数字を入れてください。', 'error');
      return;
    }

    await saveSettings({
      numberPrefix: $('s-number-prefix').value.trim() || 'MAMC',
      price: {
        exchangeRate: exchangeRate,
        shippingJpy: isFinite(shipping) ? shipping : DEFAULT_PRICE_SETTINGS.shippingJpy,
        profitJpy: isFinite(profit) ? profit : DEFAULT_PRICE_SETTINGS.profitJpy,
        roundUnit: (isFinite(roundUnit) && roundUnit >= 1) ? roundUnit : DEFAULT_PRICE_SETTINGS.roundUnit
      },
      snsTemplate: $('s-sns-template').value || DEFAULT_SNS_TEMPLATE
    });

    setStatus('設定を保存しました。', 'success');
    console.log('[MAMC設定] 設定を保存しました');
  } catch (err) {
    console.error('[MAMC設定]', err);
    setStatus('保存に失敗しました: ' + err.message, 'error');
  }
}

/** 入力欄を初期値に戻す(保存ボタンを押すまで確定しない) */
function resetForm() {
  $('s-exchange-rate').value = DEFAULT_PRICE_SETTINGS.exchangeRate;
  $('s-shipping').value = DEFAULT_PRICE_SETTINGS.shippingJpy;
  $('s-profit').value = DEFAULT_PRICE_SETTINGS.profitJpy;
  $('s-round-unit').value = DEFAULT_PRICE_SETTINGS.roundUnit;
  $('s-number-prefix').value = 'MAMC';
  $('s-sns-template').value = DEFAULT_SNS_TEMPLATE;
  setStatus('初期値を入力しました。「設定を保存」を押すと確定します。', 'success');
}

document.addEventListener('DOMContentLoaded', function () {
  loadForm().catch(function (err) {
    console.error('[MAMC設定]', err);
    setStatus('設定の読み込みに失敗しました: ' + err.message, 'error');
  });
  $('btn-save').addEventListener('click', saveForm);
  $('btn-reset').addEventListener('click', resetForm);
});
