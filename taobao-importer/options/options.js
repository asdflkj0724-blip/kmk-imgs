/**
 * options.js
 * ============================================================
 * 設定画面の動き。
 *
 * ・ブランドの追加/削除と、ブランドごとの
 *   価格ルール（換算レート・計算ステップ・丸め単位）と
 *   タイトルルール（削除・置き換え・並び順）の編集
 * ・仕入れ先サイトのリスト
 * ・管理番号の桁数
 * ・SNS投稿文テンプレート
 * を chrome.storage.local に保存します。
 * ============================================================
 */

function $(id) {
  return document.getElementById(id);
}

// 画面で編集中のデータ（保存ボタンを押すまでストレージには書き込まない）
let state = null;
// いま編集中のブランドの番号（state.brands の何番目か）
let currentIndex = 0;

// ---------- ブランドの表示・読み書き ----------

/** ブランド選択ドロップダウンを作り直す */
function renderBrandSelect() {
  const sel = $('b-select');
  sel.textContent = '';
  state.brands.forEach((b, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = b.name + '（' + b.prefix + '）';
    sel.appendChild(opt);
  });
  sel.value = currentIndex;
}

/** 指定した番号のブランドをフォームに表示する */
function loadBrandForm(i) {
  currentIndex = i;
  const b = state.brands[i];
  $('b-name').value = b.name;
  $('b-prefix').value = b.prefix;
  $('b-rate').value = b.priceRule.exchangeRate;
  $('b-round').value = b.priceRule.roundUnit;
  renderSteps(b.priceRule.steps);
  $('b-t-remove').value = (b.titleRule.removeWords || []).join(', ');
  $('b-t-replace').value = replaceListToText(b.titleRule.replaceList);
  $('b-t-format').value = b.titleRule.format || '{{brand}} {{title}}';
  $('b-sns').value = b.snsTemplate || '';
  updatePreviews();
}

/** フォームの内容を、編集中のブランド（state.brands[currentIndex]）に反映する */
function readBrandForm() {
  const b = state.brands[currentIndex];
  if (!b) return;
  b.name = $('b-name').value.trim() || b.name;
  // 頭文字は英数字の大文字だけに整える（管理番号に使うため）
  const prefix = $('b-prefix').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (prefix) b.prefix = prefix;
  b.priceRule = {
    exchangeRate: parseFloat($('b-rate').value) || 1,
    steps: readSteps(),
    roundUnit: parseInt($('b-round').value, 10) || 1
  };
  b.titleRule = {
    format: $('b-t-format').value.trim() || '{{brand}} {{title}}',
    removeWords: parseWordList($('b-t-remove').value),
    replaceList: parseReplaceList($('b-t-replace').value)
  };
  // 空欄なら null（= 共通のSNSテンプレートを使う）
  b.snsTemplate = $('b-sns').value.trim() || null;
}

// products.csv で使える列名の一覧（打ち間違いチェック用）
const CSV_KEYS = [
  'id', 'brand', 'product_name', 'original_title', 'price', 'original_price',
  'list_price', 'currency', 'product_url', 'product_id', 'image', 'images',
  'color', 'size', 'post_text', 'supplier', 'created_at'
];

// ---------- 計算ステップの表 ----------

/** ステップの配列 → 表の行 */
function renderSteps(steps) {
  const body = $('steps-body');
  body.textContent = '';
  (steps || []).forEach((step) => addStepRow(step));
}

/** 表に1行追加する */
function addStepRow(step) {
  const body = $('steps-body');
  const tr = document.createElement('tr');

  const tdNo = document.createElement('td');
  tdNo.className = 'step-no';

  const tdOp = document.createElement('td');
  const opSel = document.createElement('select');
  for (const [op, label] of Object.entries(PRICE_STEP_LABELS)) {
    const opt = document.createElement('option');
    opt.value = op;
    opt.textContent = label;
    opSel.appendChild(opt);
  }
  opSel.value = step && step.op ? step.op : 'add';
  opSel.addEventListener('change', updatePreviews);
  tdOp.appendChild(opSel);

  const tdVal = document.createElement('td');
  const valInput = document.createElement('input');
  valInput.type = 'number';
  valInput.step = '0.01';
  valInput.value = step && step.value !== undefined ? step.value : 0;
  valInput.addEventListener('input', updatePreviews);
  tdVal.appendChild(valInput);

  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.textContent = '削除';
  delBtn.className = 'small';
  delBtn.addEventListener('click', () => {
    tr.remove();
    renumberSteps();
    updatePreviews();
  });
  tdDel.appendChild(delBtn);

  tr.appendChild(tdNo);
  tr.appendChild(tdOp);
  tr.appendChild(tdVal);
  tr.appendChild(tdDel);
  body.appendChild(tr);
  renumberSteps();
}

/** 「順番」列の数字を振り直す */
function renumberSteps() {
  let i = 1;
  for (const tr of $('steps-body').children) {
    tr.querySelector('.step-no').textContent = i++;
  }
}

/** 表の行 → ステップの配列 */
function readSteps() {
  const steps = [];
  for (const tr of $('steps-body').children) {
    const op = tr.querySelector('select').value;
    const value = parseFloat(tr.querySelector('input').value) || 0;
    steps.push({ op, value });
  }
  return steps;
}

// ---------- プレビュー ----------

/** フォームの現在値から価格・タイトルのプレビューを更新 */
function updatePreviews() {
  const rule = {
    exchangeRate: parseFloat($('b-rate').value) || 1,
    steps: readSteps(),
    roundUnit: parseInt($('b-round').value, 10) || 1
  };
  const sample = parseFloat($('p-sample').value) || 0;
  const result = calculateSellingPrice(sample, rule);
  $('price-preview').textContent =
    ' → 販売価格 ' + (formatJpy(result) || '—') + '　（' + describePriceRule(rule) + '）';

  const titleRule = {
    format: $('b-t-format').value.trim() || '{{brand}} {{title}}',
    removeWords: parseWordList($('b-t-remove').value),
    replaceList: parseReplaceList($('b-t-replace').value)
  };
  const brandName = $('b-name').value.trim() || 'ブランド名';
  $('title-preview').textContent =
    '→ ' + buildProductTitle($('t-sample').value, brandName, titleRule);
}

// ---------- メッセージ ----------

function showMessage(text, isError) {
  const el = $('message');
  el.textContent = text;
  el.className = 'message' + (isError ? ' error' : '');
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 3000);
}

// ---------- 保存・リセット ----------

async function saveAll() {
  try {
    readBrandForm();

    // 頭文字の重複チェック（同じ頭文字だと管理番号がぶつかるため）
    const prefixes = state.brands.map((b) => b.prefix);
    const dup = prefixes.find((p, i) => prefixes.indexOf(p) !== i);
    if (dup) {
      showMessage('管理番号の頭文字「' + dup + '」が複数のブランドで使われています。別の文字にしてください。', true);
      return;
    }

    state.suppliers = $('s-suppliers').value
      .split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    if (state.suppliers.length === 0) state.suppliers = DEFAULT_SUPPLIERS.slice();

    state.settings.codeDigits = parseInt($('s-digits').value, 10) || 6;

    // CSVの列構成（1行1列名）。打ち間違いがあれば保存せず知らせる
    const columns = $('s-csv-columns').value
      .split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    const badKey = columns.find((c) => !CSV_KEYS.includes(c));
    if (badKey) {
      showMessage('CSVの列名「' + badKey + '」は使えません。上の一覧の名前を使ってください。', true);
      return;
    }
    state.settings.csvColumns = columns.length > 0 ? columns : DEFAULT_CSV_COLUMNS.slice();

    await saveBrands(state.brands);
    await saveSuppliers(state.suppliers);
    await saveSettings(state.settings);
    await saveSnsTemplate($('s-template').value);

    renderBrandSelect();
    showMessage('保存しました。次の取り込みから反映されます。');
  } catch (e) {
    console.error('[商品取り込み] 設定の保存に失敗:', e);
    showMessage('保存に失敗しました: ' + e.message, true);
  }
}

async function resetAll() {
  if (!confirm('ブランド・仕入れ先・SNSテンプレートをすべて初期値に戻しますか？\n（保存済みの商品データは消えません）')) return;
  state.brands = JSON.parse(JSON.stringify(DEFAULT_BRANDS));
  state.suppliers = DEFAULT_SUPPLIERS.slice();
  state.settings = Object.assign({}, DEFAULT_GLOBAL_SETTINGS);
  state.snsTemplate = DEFAULT_SNS_TEMPLATE;
  await saveBrands(state.brands);
  await saveSuppliers(state.suppliers);
  await saveSettings(state.settings);
  await saveSnsTemplate(state.snsTemplate);
  currentIndex = 0;
  fillFormsFromState();
  showMessage('初期値に戻しました。');
}

/** state の内容を画面全体に反映する */
function fillFormsFromState() {
  renderBrandSelect();
  loadBrandForm(currentIndex);
  $('s-suppliers').value = state.suppliers.join('\n');
  $('s-digits').value = state.settings.codeDigits;
  $('s-csv-columns').value = (state.settings.csvColumns || DEFAULT_CSV_COLUMNS).join('\n');
  $('s-template').value = state.snsTemplate;
}

// ---------- 初期化 ----------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await dbLoad();
    state = {
      brands: data.brands,
      suppliers: data.suppliers,
      settings: data.settings,
      snsTemplate: data.snsTemplate
    };
    fillFormsFromState();

    // ブランドを切り替えたら、編集中の内容を保持してから表示を替える
    $('b-select').addEventListener('change', (ev) => {
      readBrandForm();
      loadBrandForm(parseInt(ev.target.value, 10));
    });

    $('btn-add-brand').addEventListener('click', () => {
      const name = prompt('新しいブランド名を入力してください（例: Old Order）');
      if (!name) return;
      let prefix = prompt(
        '管理番号の頭文字を入力してください（英数字。例: OLDORDER）',
        name.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      );
      if (!prefix) return;
      prefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (!prefix) return;
      if (state.brands.some((b) => b.prefix === prefix)) {
        showMessage('頭文字「' + prefix + '」はすでに使われています。', true);
        return;
      }
      readBrandForm();
      state.brands.push(createBrand(name.trim(), prefix));
      currentIndex = state.brands.length - 1;
      renderBrandSelect();
      loadBrandForm(currentIndex);
      showMessage('ブランドを追加しました。内容を設定して「保存する」を押してください。');
    });

    $('btn-del-brand').addEventListener('click', () => {
      if (state.brands.length <= 1) {
        showMessage('ブランドは最低1つ必要です。', true);
        return;
      }
      const b = state.brands[currentIndex];
      if (!confirm('ブランド「' + b.name + '」を削除しますか？\n（登録済みの商品は消えません）')) return;
      state.brands.splice(currentIndex, 1);
      currentIndex = 0;
      renderBrandSelect();
      loadBrandForm(0);
    });

    $('btn-add-step').addEventListener('click', () => {
      addStepRow({ op: 'add', value: 0 });
      updatePreviews();
    });

    // 入力のたびにプレビューを更新
    for (const id of ['b-name', 'b-rate', 'b-round', 'p-sample',
                      'b-t-remove', 'b-t-replace', 'b-t-format', 't-sample']) {
      $(id).addEventListener('input', updatePreviews);
    }

    $('btn-save').addEventListener('click', saveAll);
    $('btn-reset').addEventListener('click', resetAll);
  } catch (e) {
    console.error('[商品取り込み] 設定画面の初期化に失敗:', e);
    showMessage('設定画面の初期化に失敗しました: ' + e.message, true);
  }
});
