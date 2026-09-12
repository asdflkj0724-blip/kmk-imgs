/**
 * title.js
 * ============================================================
 * 元の商品タイトルを「自分のお店用のタイトル」に変換するファイル。
 *
 * 変換ルールはブランドごとに設定画面から変更できます：
 *   ① removeWords … 不要な文字を削除
 *   ② replaceList … 特定の文字を別の文字に置き換え
 *   ③ format      … 最後に並びを整える（{{brand}} {{title}} など）
 * ============================================================
 */

/**
 * タイトルルールを適用して販売用タイトルを作る
 * @param {string} originalTitle - 元サイトのタイトル
 * @param {string} brandName - ブランド名（例: MAMC）
 * @param {object} titleRule - タイトルルール（format, removeWords, replaceList）
 * @returns {string} 変換後のタイトル
 */
function buildProductTitle(originalTitle, brandName, titleRule) {
  const rule = titleRule || DEFAULT_TITLE_RULE;
  let t = String(originalTitle || '');

  // ① 不要な文字を削除
  for (const w of rule.removeWords || []) {
    if (w) t = t.split(w).join('');
  }

  // ② 置き換え
  for (const r of rule.replaceList || []) {
    if (r && r.from) t = t.split(r.from).join(r.to || '');
  }

  t = t.replace(/\s+/g, ' ').trim();

  // ③ 並びを整える
  const format = rule.format || '{{title}}';
  return format
    .replace(/\{\{brand\}\}/g, brandName || '')
    .replace(/\{\{title\}\}/g, t)
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------
// 設定画面用：テキスト ⇔ ルールの変換
// ------------------------------------------------------------

/** 「,」や改行で区切られたテキスト → 配列（削除ワード用） */
function parseWordList(text) {
  return String(text || '')
    .split(/[\n,、，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 置き換えリストのテキスト → 配列
 * 1行につき1つ、「古い文字=>新しい文字」の形で書く。
 * 「=>」の右側を空にすると削除と同じ意味になる。
 */
function parseReplaceList(text) {
  const list = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('=>')) continue;
    const idx = line.indexOf('=>');
    const from = line.slice(0, idx).trim();
    const to = line.slice(idx + 2).trim();
    if (from) list.push({ from, to });
  }
  return list;
}

/** 置き換えリストの配列 → 設定画面表示用のテキスト */
function replaceListToText(list) {
  return (list || []).map((r) => r.from + '=>' + (r.to || '')).join('\n');
}
