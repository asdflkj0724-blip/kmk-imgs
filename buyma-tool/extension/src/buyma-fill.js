/*
 * BUYMA の出品画面に、作った出品データを入れる（「BUYMAに反映」ボタンを押したときだけ動く）。
 *
 * 守ること
 * - ボタンを押したときに、開いている画面に1件分を入れるだけ
 * - すでに入っている欄・選ばれている項目は変えない（自分で入れた内容を消さない）
 * - 「出品する」「入力内容を確認する」「下書き保存する」などのボタンは一切押さない
 * - 名前が一致しないもの（ブランド・配送方法・カテゴリ）は、勝手に選ばずに知らせる
 *
 * BUYMA の出品画面（2026年11月にパソコンで保存した画面）の作り
 * - 1行ごとに .bmm-l-grid があり、左に見出し（.bmm-c-summary__ttl）、右に入力欄
 * - カテゴリは react-select（.Select）。1段目を選ぶと2段目・3段目が出る
 * - 配送方法は、登録済みの配送方法の表。行ごとに「名前」と「説明文」がある
 * - 商品画像は input[type=file]（最大20枚）
 */
(function (root) {
  'use strict';

  /** 文字を入れる欄。label は BUYMA の出品画面の見出し */
  const TEXT_FIELDS = [
    { key: 'title', label: '商品名', exclude: ['ブランド', 'モデル'] },
    { key: 'description', label: '商品コメント', exclude: [] },
    { key: 'price', label: '商品価格', exclude: ['参考価格', '通常出品価格'] },
    { key: 'shopName', label: '買付先ショップ名', exclude: [] },
    { key: 'memo', label: '出品メモ', exclude: [] },
    { key: 'sizeNote', label: '色・サイズ補足情報', exclude: [] },
  ];
  const MAX_IMAGES = 20;

  const FIELD_SELECTOR =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=search]), textarea';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs, stepMs) {
    const end = Date.now() + (timeoutMs || 3000);
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(stepMs || 100);
    }
  }

  function norm(s) {
    return (s || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
  }

  /** 見出しの文字（「必須」「任意」「出品後の変更不可」などの添え書きは除く） */
  function headingText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, option, button').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/[\s　]+/g, '').replace(/必須|任意|\/?出品後の変更不可|[*＊※/／]/g, '');
  }

  function isUsable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /** BUYMA の1行（.bmm-l-grid）を見出しで探す */
  function rowByTitle(doc, title) {
    const want = title.replace(/[\s　]+/g, '');
    for (const t of doc.querySelectorAll('.bmm-c-summary__ttl')) {
      if (headingText(t) === want) return t.closest('.bmm-l-grid') || t.parentElement;
    }
    return null;
  }

  /** 見出しより後ろで、いちばん近い入力欄 */
  function fieldAfter(heading) {
    const forId = heading.getAttribute && heading.getAttribute('for');
    if (forId) {
      const el = heading.ownerDocument.getElementById(forId);
      if (el && el.matches(FIELD_SELECTOR)) return el;
    }
    let node = heading;
    for (let depth = 0; depth < 5 && node.parentElement; depth++) {
      node = node.parentElement;
      const f = Array.from(node.querySelectorAll(FIELD_SELECTOR)).find(
        (x) => heading.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (f) return f;
    }
    return null;
  }

  function findTextField(doc, spec) {
    const want = spec.label.replace(/[\s　]+/g, '');
    const candidates = Array.from(doc.querySelectorAll('label, th, dt, legend, h1, h2, h3, h4, h5, p, span, div'));
    for (const exact of [true, false]) {
      for (const el of candidates) {
        if (el.children.length > 6) continue;
        // 入力欄を中に持つ大きな囲みは見出しではない（label で入力欄を包む作りだけは認める）
        if (el.tagName !== 'LABEL' && el.querySelector(FIELD_SELECTOR)) continue;
        const t = headingText(el);
        if (!t || t.length > 20) continue;
        if (spec.exclude.some((x) => t.includes(x))) continue;
        if (exact ? t !== want : !t.startsWith(want)) continue;
        const f = fieldAfter(el);
        if (f && isUsable(f)) return f;
      }
    }
    return null;
  }

  /** React などの画面でも反映されるよう、元の仕組みで値を入れてイベントを出す */
  function setValue(el, value) {
    const win = el.ownerDocument.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    el.dispatchEvent(new win.Event('blur', { bubbles: true }));
  }

  function mouse(el, type) {
    const win = el.ownerDocument.defaultView;
    el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: win }));
  }

  /** 人がマウスで押したときと同じ順番で知らせる（候補の一覧は、作りによって反応する合図が違うため） */
  function press(el) {
    for (const type of ['mouseover', 'mousemove', 'mousedown']) mouse(el, type);
    if (!el.isConnected) return; // mousedown で選ばれて一覧が閉じた
    mouse(el, 'mouseup');
    if (el.isConnected) el.click();
  }

  // ---- 文字の欄 ----
  function fillTextFields(doc, values, report) {
    for (const spec of TEXT_FIELDS) {
      const v = values[spec.key];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const field = findTextField(doc, spec);
      if (!field) {
        report.missing.push(spec.label);
        continue;
      }
      if (String(field.value || '').trim() !== '') {
        report.skipped.push(spec.label);
        continue;
      }
      setValue(field, v);
      report.filled.push(spec.label);
    }
  }

  // ---- カテゴリ（react-select を順番に選ぶ） ----
  /** 候補の中から、名前がはっきり合うものを1つだけ選ぶ（合わない・複数あるときは選ばない） */
  function bestOption(options, want) {
    const w = norm(want);
    if (!w) return null;
    const exact = options.filter((o) => norm(o.textContent) === w);
    if (exact.length === 1) return exact[0];
    const partial = options.filter((o) => {
      const t = norm(o.textContent);
      return t && (t.includes(w) || w.includes(t));
    });
    return partial.length === 1 ? partial[0] : null;
  }

  function selectedLabel(sel) {
    const v = sel.querySelector('.Select-value-label, .Select-value');
    return v ? (v.textContent || '').trim() : '';
  }

  async function selectCategory(doc, path, report) {
    const segments = String(path || '')
      .split(/\s*[>＞›»\/／]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segments.length) return;
    const row = rowByTitle(doc, 'カテゴリ');
    if (!row) {
      report.missing.push('カテゴリ');
      return;
    }
    const chosen = [];
    for (let i = 0; i < segments.length; i++) {
      const sel = await waitFor(() => row.querySelectorAll('.Select')[i], 2000);
      if (!sel) break; // それより下の段がない
      const already = selectedLabel(sel);
      if (already) {
        // すでに選ばれているときは変えない
        if (i === 0) {
          report.skipped.push('カテゴリ');
          return;
        }
        chosen.push(already);
        continue;
      }
      const control = sel.querySelector('.Select-control');
      if (!control) break;
      mouse(control, 'mousedown');
      const options = await waitFor(() => {
        const list = Array.from(sel.querySelectorAll('.Select-option'));
        return list.length ? list : null;
      }, 2500);
      if (!options) {
        report.notes.push(`カテゴリの${i + 1}段目の候補が出ませんでした。ご自身で選んでください。`);
        return;
      }
      const pick = bestOption(options, segments[i]);
      if (!pick) {
        mouse(control, 'mousedown'); // 開いた候補を閉じる
        report.notes.push(
          `カテゴリ「${segments.slice(0, i + 1).join(' > ')}」に合う候補が見つからなかったので、${i + 1}段目からご自身で選んでください。`
        );
        if (chosen.length) report.filled.push('カテゴリ（' + chosen.join(' > ') + ' まで）');
        return;
      }
      mouse(pick, 'mousedown');
      await waitFor(() => selectedLabel(sel), 2000);
      chosen.push((pick.textContent || '').trim());
    }
    if (chosen.length) report.filled.push('カテゴリ（' + chosen.join(' > ') + '）');
  }

  /**
   * カテゴリの i 段目（0から）を開いて、候補の名前を返す（AI に選んでもらうため）。
   * すでに選ばれていれば selected に名前が入る。段がなければ exists: false。
   */
  async function categoryLevel(doc, i) {
    const row = rowByTitle(doc, 'カテゴリ');
    if (!row) return { exists: false };
    const sel = await waitFor(() => row.querySelectorAll('.Select')[i], 2500);
    if (!sel) return { exists: false };
    const already = selectedLabel(sel);
    if (already) return { exists: true, selected: already, options: [] };
    const options = await openOptions(sel);
    return { exists: true, selected: '', options: options ? options.map((o) => (o.textContent || '').trim()) : [] };
  }

  async function openOptions(sel) {
    const now = () => {
      const list = Array.from(sel.querySelectorAll('.Select-option'));
      return list.length ? list : null;
    };
    if (now()) return now();
    const control = sel.querySelector('.Select-control');
    if (!control) return null;
    mouse(control, 'mousedown');
    return waitFor(now, 2500);
  }

  /** カテゴリの i 段目で、index 番目の候補を選ぶ（-1 なら閉じるだけ）。選んだ名前を返す */
  async function categoryPick(doc, i, index) {
    const row = rowByTitle(doc, 'カテゴリ');
    const sel = row && row.querySelectorAll('.Select')[i];
    if (!sel) return '';
    if (selectedLabel(sel)) return selectedLabel(sel);
    const options = await openOptions(sel);
    if (!options) return '';
    if (index < 0 || index >= options.length) {
      const control = sel.querySelector('.Select-control');
      if (control) mouse(control, 'mousedown');
      return '';
    }
    const want = (options[index].textContent || '').trim();
    press(options[index]);
    let got = await waitFor(() => selectedLabel(sel), 2500);
    if (!got) {
      // まだ選ばれていなければ、開き直して同じ名前の候補をもう一度押す
      const again = await openOptions(sel);
      const same = again && again.find((o) => (o.textContent || '').trim() === want);
      if (same) {
        press(same);
        got = await waitFor(() => selectedLabel(sel), 2500);
      }
    }
    return got || '';
  }

  // ---- ブランド（候補が出たら、名前が完全に同じものだけ選ぶ） ----
  async function fillBrand(doc, brand, report, noBrandIfUnknown) {
    const row = rowByTitle(doc, 'ブランド');
    if (!row) {
      if (brand) report.missing.push('ブランド');
      return;
    }
    if (!brand) {
      if (!noBrandIfUnknown) {
        report.notes.push('ブランドは仕入れ先で確認できなかったので入れていません。ブランドがない商品なら「ブランド指定なし」を選んでください。');
        return;
      }
      // 設定で「わからないときはブランド指定なし」にしているとき
      const box = Array.from(row.querySelectorAll('label')).find((l) => /ブランド指定なし/.test(l.textContent || ''));
      const cb = box && box.querySelector('input[type=checkbox]');
      if (!cb) {
        report.notes.push('「ブランド指定なし」が見つかりませんでした。ご自身で選んでください。');
        return;
      }
      if (cb.checked) {
        report.skipped.push('ブランド');
        return;
      }
      box.click();
      if (await waitFor(() => cb.checked, 800)) report.filled.push('ブランド（指定なし）');
      else report.notes.push('「ブランド指定なし」にチェックを付けられませんでした。ご自身で選んでください。');
      return;
    }
    const input = row.querySelector('input[type=text]');
    if (!input) {
      report.missing.push('ブランド');
      return;
    }
    if (String(input.value || '').trim()) {
      report.skipped.push('ブランド');
      return;
    }
    setValue(input, brand);
    input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    const w = norm(brand);
    // 「MAMC」と「MAMC(エムエーエムシー)」のような、読み方付きの候補も同じとみなす
    const same = (el) => {
      const t = norm(el.textContent);
      if (t === w) return true;
      // 「名前(読み方)」でぴったり終わるものだけ（候補を全部まとめた外側の箱は除く）
      if (!t.startsWith(w + '(') && !t.startsWith(w + '（')) return false;
      const rest = t.slice(w.length + 1);
      const close = rest.search(/[)）]/);
      return close >= 0 && close === rest.length - 1;
    };
    const find = () => {
      // 候補の一覧は、ブランドの欄の中に出るとは限らない（ページの最後に出す作りもある）ので、ページ全体から探す
      const scopes = [row, doc.body];
      for (const scope of scopes) {
        const hit = Array.from(scope.querySelectorAll('li, [role=option], a, div, span, p'))
          .filter((el) => el !== input && el.childElementCount <= 2 && !el.closest('#rakushuppin-banner') && el.getClientRects().length)
          .find(same);
        if (hit) return hit.closest('li, [role=option], a') || hit;
      }
      return null;
    };
    const match = await waitFor(find, 5000);
    if (match) {
      press(match);
      // 選ばれると、欄の中身が候補の名前になるか、一覧が閉じる
      await waitFor(() => !match.isConnected || norm(input.value) !== w || !match.getClientRects().length, 1500);
      report.filled.push('ブランド');
    } else {
      report.notes.push(`ブランド「${brand}」を入れました。出てきた候補の中から選んでください（同じ名前の候補が見つからなかったので、選んでいません）。`);
    }
  }

  // ---- 配送方法（登録済みの表から、名前が一致する行だけチェックする） ----
  function shippingRows(doc) {
    const row = rowByTitle(doc, '配送方法');
    if (!row) return [];
    return Array.from(row.querySelectorAll('tbody tr'))
      .filter((tr) => tr.querySelector('input[type=checkbox]') && !/disabled/.test(tr.className))
      .map((tr) => {
        const ps = tr.querySelectorAll('td p');
        const name = ps[0] ? ps[0].textContent.trim() : '';
        const descEl = tr.querySelector('.bmm-c-form-table__desc');
        const desc = descEl ? descEl.textContent.trim() : '';
        return { tr, name, desc, input: tr.querySelector('input[type=checkbox]') };
      })
      .filter((r) => r.name);
  }

  /** 設定に取り込むときの名前：「配送方法の名前｜説明文」（説明文がなければ名前だけ） */
  function shippingKey(r) {
    return r.desc ? `${r.name}｜${r.desc}` : r.name;
  }

  function matchShipping(rows, saved) {
    const s = String(saved || '').trim();
    if (!s) return [];
    // 1. 一言一句同じ  2. 空白の違いだけ  3. 説明文だけで一致  4. 名前だけで一致
    const tests = [
      (r) => shippingKey(r) === s,
      (r) => norm(shippingKey(r)) === norm(s) || norm(r.name + r.desc) === norm(s),
      (r) => r.desc && norm(r.desc) === norm(s),
      (r) => norm(r.name) === norm(s),
    ];
    for (const t of tests) {
      const hit = rows.filter(t);
      if (hit.length) return hit;
    }
    return [];
  }

  async function selectShipping(doc, saved, report) {
    if (!saved) {
      report.notes.push('配送方法が選ばれていないので、入れていません。');
      return;
    }
    const rows = shippingRows(doc);
    if (!rows.length) {
      report.missing.push('配送方法');
      return;
    }
    const hit = matchShipping(rows, saved);
    if (hit.length !== 1) {
      report.notes.push(
        hit.length
          ? `配送方法「${saved}」に当てはまるものが${hit.length}つあるので、選んでいません。ご自身で選ぶか、拡張機能の設定で「この画面の配送方法を取り込む」を使ってください。`
          : `配送方法「${saved}」が、BUYMA の登録済みの配送方法に見つかりませんでした。名前を確かめてください（別の配送方法は選んでいません）。`
      );
      return;
    }
    const r = hit[0];
    if (r.input.checked) {
      report.skipped.push('配送方法');
      return;
    }
    // BUYMA は行を押すとチェックが付く作り。付かなければチェックの部分を押す
    r.tr.click();
    if (!(await waitFor(() => r.input.checked, 800))) {
      const label = r.input.closest('label') || r.input;
      label.click();
      await waitFor(() => r.input.checked, 800);
    }
    if (r.input.checked) report.filled.push('配送方法');
    else report.notes.push(`配送方法「${saved}」にチェックを付けられませんでした。ご自身で選んでください。`);
  }

  function readShippingOptions(doc) {
    return shippingRows(doc).map(shippingKey);
  }

  // ---- 商品画像（正方形・透かし入りの画像を、ファイルを選ぶ欄に入れる） ----
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function uploadImages(doc, images, report) {
    if (!images || !images.length) return;
    const row = rowByTitle(doc, '商品画像');
    const input = row && row.querySelector('input[type=file]');
    if (!input) {
      report.missing.push('商品画像');
      return;
    }
    const existing = row.querySelectorAll('.bmm-c-img-upload__box:not(.bmm-c-img-upload__box--empty), .bmm-c-img-upload img');
    if (existing.length) {
      report.skipped.push('商品画像');
      return;
    }
    const win = doc.defaultView;
    const dt = new win.DataTransfer();
    for (const img of images.slice(0, MAX_IMAGES)) {
      dt.items.add(new win.File([base64ToBytes(img.base64)], img.name, { type: img.type || 'image/jpeg' }));
    }
    input.files = dt.files;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    report.filled.push(`商品画像（${dt.files.length}枚）`);
  }

  // ---- お知らせ ----
  function showBanner(doc, lines, isError) {
    let el = doc.getElementById('rakushuppin-banner');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'rakushuppin-banner';
      el.style.cssText =
        'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:420px;max-height:70vh;overflow:auto;padding:12px 16px;border-radius:8px;' +
        'font:14px/1.6 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);white-space:pre-line;';
      const close = doc.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', '閉じる');
      close.style.cssText = 'float:right;margin-left:8px;border:0;background:none;font-size:16px;cursor:pointer;color:inherit;';
      close.addEventListener('click', () => el.remove());
      el.appendChild(close);
      el.appendChild(doc.createElement('span'));
      doc.body.appendChild(el);
    }
    el.style.background = isError ? '#fde8e8' : '#e8f5ee';
    el.style.color = isError ? '#8a1c1c' : '#14532d';
    el.lastChild.textContent = lines.join('\n');
  }

  function bannerLines(report) {
    const lines = [];
    if (report.filled.length) lines.push('ラク出品：' + report.filled.join('・') + ' を入れました。');
    if (report.skipped.length) lines.push('すでに入っていたので、そのままにした欄：' + report.skipped.join('・'));
    if (report.missing.length) lines.push('見つからなかった欄：' + report.missing.join('・') + '（ご自身で入れてください）');
    lines.push(...report.notes);
    lines.push('内容を確かめてから「入力内容を確認する」を押してください。');
    return lines;
  }

  /** 文字の欄だけを入れる（すぐ終わる） */
  function fillBuyma(doc, values) {
    const report = { filled: [], skipped: [], missing: [], notes: [] };
    fillTextFields(doc, values, report);
    showBanner(doc, bannerLines(report), !report.filled.length);
    return report;
  }

  /**
   * 「買付先メモ」の1行目に、買付先名・URL・説明（仕入れ値）を入れる。
   * それぞれ、すでに入っている欄は変えない。「買付先メモを追加」は押さない。
   */
  function fillSourceMemo(doc, values, report) {
    if (!values.sourceUrl) return;
    const row = rowByTitle(doc, '買付先メモ');
    if (!row) {
      report.missing.push('買付先メモ（URL）');
      return;
    }
    const field = (unit) => {
      for (const u of Array.from(row.querySelectorAll('.bmm-c-custom-text__unit'))) {
        if (norm(u.textContent) !== norm(unit)) continue;
        const box = u.closest('.bmm-c-custom-text') || u.parentElement;
        const input = box && box.querySelector('input, textarea');
        if (input) return input;
      }
      return null;
    };
    const url = field('URL');
    if (!url) {
      report.missing.push('買付先メモ（URL）');
      return;
    }
    if (url.value.trim()) {
      report.skipped.push('買付先メモ（URL）');
      return;
    }
    setValue(url, values.sourceUrl);
    const name = field('買付先名');
    if (name && !name.value.trim() && values.sourceName) setValue(name, values.sourceName.slice(0, 100));
    const note = field('説明');
    if (note && !note.value.trim() && values.sourceNote) setValue(note, values.sourceNote.slice(0, 200));
    report.filled.push('買付先メモ（URL）');
  }

  // ---- 色・サイズ ----
  /** 色の名前から、BUYMA の「色の系統」を決める。名前の最後のほうにある色の言葉を優先（例：ミルクホワイト→ホワイト） */
  const COLOR_RULES = [
    ['マルチカラー', /マルチ|ミックス|柄|チェック|ストライプ|ボーダー|花|ドット|レオパード|迷彩|カモフラ|ペイズリー/],
    ['ホワイト', /ホワイト|白|アイボリー|クリーム|ミルク|生成|エクリュ|オフ白/],
    ['ブラック', /ブラック|黒/],
    ['グレー', /グレー|灰|チャコール|グレイ/],
    ['ブラウン', /ブラウン|茶|キャメル|モカ|チョコ|コーヒー|テラコッタ/],
    ['ベージュ', /ベージュ|オートミール|サンド|トープ|ヌード|杏|アプリコット/],
    ['グリーン', /グリーン|緑|カーキ|オリーブ|ミント|モスグリーン/],
    ['ネイビー', /ネイビー|紺/],
    ['ブルー', /ブルー|青|水色|サックス|ターコイズ|デニム|インディゴ/],
    ['パープル', /パープル|紫|ラベンダー|ライラック/],
    ['イエロー', /イエロー|黄|マスタード|レモン/],
    ['ピンク', /ピンク|ローズ|桃/],
    ['レッド', /レッド|赤|ワイン|ボルドー|バーガンディ|えんじ/],
    ['オレンジ', /オレンジ|橙/],
    ['シルバー', /シルバー|銀/],
    ['ゴールド', /ゴールド|金/],
    ['クリア', /クリア|透明/],
  ];
  function colorFamily(name) {
    const t = String(name || '').normalize('NFKC');
    if (COLOR_RULES[0][1].test(t)) return 'マルチカラー';
    let best = '';
    let pos = -1;
    for (const [key, re] of COLOR_RULES.slice(1)) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(t))) {
        if (m.index >= pos) {
          pos = m.index;
          best = key;
        }
      }
    }
    return best;
  }

  /** 色・サイズ欄の、指定の名前のタブを開いて、そのタブの中身を返す */
  async function openVariationTab(doc, name) {
    const row = rowByTitle(doc, '色・サイズ');
    if (!row) return null;
    const tab = Array.from(row.querySelectorAll('[role="tab"]')).find((t) => norm(t.textContent) === norm(name));
    if (tab && !/is-active|selected/.test(tab.className) && tab.getAttribute('aria-selected') !== 'true') {
      press(tab);
      await waitFor(() => /is-active|selected/.test(tab.className) || tab.getAttribute('aria-selected') === 'true', 1500);
    }
    return row.querySelector('[role="tabpanel"].react-tabs__tab-panel--selected') || (tab ? null : row);
  }

  function rowEmpty(tr) {
    const sel = tr.querySelector('.Select');
    const label = sel ? selectedLabel(sel) : '';
    const input = tr.querySelector('input[type=text]');
    return (!label || /指定なし|選択してください/.test(label)) && (!input || !String(input.value || '').trim());
  }

  /** 空いている行を探す。なければ「追加」を押して行を増やす */
  async function nextEmptyRow(panel) {
    const rows = () => Array.from(panel.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('.Select'));
    let tr = rows().find(rowEmpty);
    if (tr) return tr;
    const before = rows().length;
    const add = Array.from(panel.querySelectorAll('a, button, [role=button], span, p')).find(
      (el) => /追加/.test(el.textContent || '') && el.childElementCount <= 2 && el.getClientRects().length
    );
    if (!add) return null;
    press(add);
    await waitFor(() => rows().length > before, 2000);
    return rows().find(rowEmpty) || null;
  }

  /** 1行に「選択欄（系統・サイズ）」と「名前の欄」を入れる */
  async function fillVariationRow(tr, optionWanted, text) {
    const sel = tr.querySelector('.Select');
    const options = sel && (await openOptions(sel));
    if (!options) return false;
    const pick = optionWanted(options);
    if (!pick) {
      const control = sel.querySelector('.Select-control');
      if (control) mouse(control, 'mousedown'); // 閉じる
      return false;
    }
    press(pick);
    await waitFor(() => selectedLabel(sel) && !/指定なし|選択してください/.test(selectedLabel(sel)), 2500);
    const input = tr.querySelector('input[type=text]');
    if (input && text) {
      await waitFor(() => !input.disabled, 1500);
      if (!input.disabled && !String(input.value || '').trim()) setValue(input, text);
    }
    return true;
  }

  /** 色：「色の系統」を選び、色名を入れる。足りない行は「追加」で増やす */
  async function fillColors(doc, colors, report) {
    const list = (colors || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 30);
    if (!list.length) return;
    const panel = await openVariationTab(doc, '色');
    if (!panel) return report.missing.push('色');
    const filled = Array.from(panel.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('.Select') && !rowEmpty(tr));
    if (filled.length) return report.skipped.push('色');
    let done = 0;
    const unsure = [];
    for (const name of list) {
      const fam = colorFamily(name) || 'マルチカラー';
      if (!colorFamily(name)) unsure.push(name);
      const tr = await nextEmptyRow(panel);
      if (!tr) break;
      const ok = await fillVariationRow(tr, (opts) => opts.find((o) => norm(o.textContent).startsWith(norm(fam))), name);
      if (!ok) break;
      done++;
    }
    if (done) report.filled.push(`色（${done}色）`);
    if (done < list.length) report.notes.push(`色は${list.length}色のうち${done}色を入れました。残り（${list.slice(done).join('・')}）はご自身で入れてください。`);
    if (unsure.length) report.notes.push(`色の系統がわからなかった色（${unsure.join('・')}）は「マルチカラー」にしました。確認してください。`);
  }

  /** サイズ：サイズの選択欄から同じ名前を選ぶ（カテゴリを選んだあとに出る）。足りない行は「追加」で増やす */
  async function fillSizes(doc, sizes, report) {
    const list = (sizes || []).map((c) => String(c).trim()).filter(Boolean).slice(0, 30);
    if (!list.length) return;
    const panel = await openVariationTab(doc, 'サイズ');
    if (!panel || !panel.querySelector('.Select')) {
      report.notes.push('サイズの欄が出ていません（カテゴリを選ぶと出ます）。サイズはご自身で選んでください。');
      return;
    }
    const filled = Array.from(panel.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('.Select') && !rowEmpty(tr));
    if (filled.length) return report.skipped.push('サイズ');
    const pickSize = (want) => (opts) => {
      const w = norm(want).replace(/サイズ$/, '');
      return (
        opts.find((o) => norm(o.textContent) === w) ||
        opts.find((o) => norm(o.textContent).replace(/[(（].*$/, '') === w) ||
        (/free|フリー|均码|onesize/i.test(want) ? opts.find((o) => /フリー|free|one/i.test(o.textContent || '')) : null)
      );
    };
    let done = 0;
    const missed = [];
    for (const name of list) {
      const tr = await nextEmptyRow(panel);
      if (!tr) {
        missed.push(...list.slice(list.indexOf(name)));
        break;
      }
      if (await fillVariationRow(tr, pickSize(name), '')) done++;
      else missed.push(name);
    }
    if (done) report.filled.push(`サイズ（${done}）`);
    if (missed.length) report.notes.push(`サイズ（${missed.join('・')}）は、BUYMA の候補に同じ名前がなかったので選んでいません。ご自身で選んでください。`);
    await openVariationTab(doc, '色');
  }

  /** 全部入れる：文字の欄 → カテゴリ → ブランド → 配送方法 → 画像 */
  async function fillBuymaAll(doc, values) {
    const report = { filled: [], skipped: [], missing: [], notes: [] };
    showBanner(doc, ['ラク出品：入力しています…'], false);
    fillTextFields(doc, values, report);
    try {
      fillSourceMemo(doc, values, report);
    } catch (e) {
      report.notes.push('買付先メモに URL を入れられませんでした。ご自身で入れてください。');
    }
    // カテゴリは、拡張機能の画面が AI と相談しながら1段ずつ選ぶ（categoryByPopup）。そうでなければここで選ぶ
    if (!values.categoryByPopup) {
      try {
        await selectCategory(doc, values.category, report);
      } catch (e) {
        report.notes.push('カテゴリを選べませんでした。ご自身で選んでください。');
      }
    }
    try {
      await fillColors(doc, values.colors, report);
    } catch (e) {
      report.notes.push('色を入れられませんでした。ご自身で選んでください。');
    }
    try {
      await fillSizes(doc, values.sizes, report);
    } catch (e) {
      report.notes.push('サイズを入れられませんでした。ご自身で選んでください。');
    }
    try {
      await fillBrand(doc, values.brand, report, values.noBrandIfUnknown === true);
    } catch (e) {
      report.notes.push('ブランドを入れられませんでした。ご自身で入れてください。');
    }
    try {
      await selectShipping(doc, values.shipping, report);
    } catch (e) {
      report.notes.push('配送方法を選べませんでした。ご自身で選んでください。');
    }
    try {
      await uploadImages(doc, values.images, report);
    } catch (e) {
      report.notes.push('画像を入れられませんでした。画像 ZIP を使ってご自身で入れてください。');
    }
    showBanner(doc, bannerLines(report), !report.filled.length);
    return report;
  }

  /**
   * 「色・サイズ」欄の作りを調べる（自動入力を作るための下調べ。値は何も変えない）。
   * 色・サイズのタブを順に開き、選択欄の候補・ボタン・入力欄・画面の作りを集めて返す。
   * 調べるのはこの欄の中だけ（会員情報など、ほかの欄は読まない）。
   */
  async function inspectVariation(doc) {
    const row = rowByTitle(doc, '色・サイズ');
    if (!row) return { found: false };
    const t = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const tabs = Array.from(row.querySelectorAll('[role="tab"]'));
    const before = Math.max(0, tabs.findIndex((x) => /is-active|selected/.test(x.className)));
    const out = { found: true, tabs: [] };
    for (const tab of tabs.length ? tabs : [null]) {
      if (tab) {
        tab.click();
        await wait(500);
      }
      const panel = row.querySelector('[role="tabpanel"].react-tabs__tab-panel--selected') || row;
      const selects = [];
      for (const sel of Array.from(panel.querySelectorAll('.Select'))) {
        const control = sel.querySelector('.Select-control');
        const item = { current: t(sel.querySelector('.Select-value')), options: [] };
        if (control && !sel.classList.contains('is-disabled')) {
          mouse(control, 'mousedown');
          const opts = await waitFor(() => {
            const list = Array.from(sel.querySelectorAll('.Select-option'));
            return list.length ? list : null;
          }, 1500);
          item.options = (opts || []).slice(0, 300).map(t);
          if (opts) mouse(control, 'mousedown'); // 開いた候補を閉じる（何も選ばない）
          await wait(150);
        }
        selects.push(item);
      }
      out.tabs.push({
        name: tab ? t(tab) : '',
        selects,
        buttons: Array.from(panel.querySelectorAll('button, [role="button"], a')).map(t).filter(Boolean),
        inputs: Array.from(panel.querySelectorAll('input, textarea, select')).map((e) => ({
          tag: e.tagName.toLowerCase(),
          type: e.getAttribute('type') || '',
          placeholder: e.getAttribute('placeholder') || '',
          disabled: !!e.disabled,
          checked: !!e.checked,
          label: t(e.closest('label')),
        })),
        html: panel.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').replace(/\svalue="[^"]*"/g, '').slice(0, 80000),
      });
    }
    if (tabs[before]) tabs[before].click();
    return out;
  }

  const api = { fillBuyma, fillBuymaAll, readShippingOptions, matchShipping, bestOption, categoryLevel, categoryPick, showBanner, inspectVariation, colorFamily, TEXT_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RakuBuymaFill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
