/*
 * 商品画像をまとめて取り、大きさをそろえて ZIP にする（ポップアップで使う）。
 * ファイル名は taobao_<商品ID>_01.jpg …（管理画面の CSV と同じ付け方。変えないこと）
 */
(function (root) {
  'use strict';

  function imageFileName(itemId, index) {
    return `taobao_${itemId || 'item'}_${String(index + 1).padStart(2, '0')}.jpg`;
  }

  /**
   * 正方形に置くときの大きさと位置。縦横の比率は変えず、商品全体が入るように白い余白を足す。
   * 元の画像より大きくはしない（引き伸ばさない）。
   */
  function squareLayout(w, h, maxPx) {
    const longSide = Math.max(w, h);
    const side = Math.max(1, Math.min(maxPx, longSide));
    const scale = side / longSide;
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    return { side, dw, dh, dx: Math.round((side - dw) / 2), dy: Math.round((side - dh) / 2) };
  }

  /**
   * 透かしの位置：右下寄り。ただし端ではなく、少し中央寄り（右から12%、下から12%）。
   * 文字の大きさは画像の幅の約4.5%。
   */
  function watermarkLayout(side) {
    const fontSize = Math.max(12, Math.round(side * 0.045));
    return { fontSize, x: Math.round(side * 0.88), y: Math.round(side * 0.88) };
  }

  /**
   * 切り出す範囲。人物の写真（縦横比 1:2 まで）は切らずに1枚のまま（正方形にするときは白い余白を足す）。
   * それより縦に長い画像（商品説明をつなげた長い画像など）だけ、上から切り分ける。
   * 切る位置は、目安（幅と同じ高さ）の前後で、いちばん「白い・一色の帯」に近い行を選ぶ
   * （手や足など、写っているものの途中で切らないため）。rows は上から下まで等間隔に並んだ各行のばらつき。
   * 1枚から切り出すのは maxTiles 枚まで。最後の小さな切れ端（幅の3割未満）は捨てる。
   */
  function tilePlan(w, h, maxTiles, rows) {
    const max = maxTiles || 4;
    if (!(h > w * 2)) return [{ sx: 0, sy: 0, sw: w, sh: h }];
    const scoreAt = (y) => (rows && rows.length ? rows[Math.min(rows.length - 1, Math.floor((y / h) * rows.length))] : 0);
    const tiles = [];
    let sy = 0;
    while (sy < h && tiles.length < max) {
      const rest = h - sy;
      if (rest < w * 0.3) break;
      if (rest <= w * 1.3) {
        tiles.push({ sx: 0, sy, sw: w, sh: rest });
        break;
      }
      let cut = sy + w;
      if (rows && rows.length) {
        // 目安の前後（幅の 0.7〜1.3 倍）で、いちばん一色に近い行。同じくらいなら目安に近いほう
        let best = Infinity;
        const step = Math.max(1, Math.floor(h / rows.length));
        for (let y = sy + Math.round(w * 0.7); y <= Math.min(h - 1, sy + Math.round(w * 1.3)); y += step) {
          const score = scoreAt(y) + Math.abs(y - (sy + w)) / w; // 少しだけ目安に寄せる
          if (score < best) {
            best = score;
            cut = y;
          }
        }
      }
      tiles.push({ sx: 0, sy, sw: w, sh: cut - sy });
      sy = cut;
    }
    return tiles;
  }

  /** 各行の明るさのばらつき（上から下まで n 行ぶん）。白い帯は 0 に近い */
  function rowProfile(bmp, n) {
    const W = 32;
    const H = Math.max(1, Math.min(n || 400, bmp.height));
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const rows = [];
    for (let y = 0; y < H; y++) {
      let sum = 0;
      let sq = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += v;
        sq += v * v;
      }
      const mean = sum / W;
      rows.push(Math.sqrt(Math.max(0, sq / W - mean * mean)));
    }
    return rows;
  }

  /** ほぼ一色（白い余白だけなど）の部分か。RGBA の並びを受け取り、明るさのばらつきで決める */
  function isBlankPixels(data) {
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += y;
      sq += y * y;
      n++;
    }
    if (!n) return true;
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sq / n - mean * mean)) < 4;
  }

  /**
   * 商品説明の長い画像（つなぎ直したもの）を、白い・一色のすき間で「まとまり」に分ける。
   * rows：上から下まで等間隔の各行について、その行が一色（すき間）なら true。
   * 返すのは元の大きさでの {sy, sh}。人1人・サイズ表1つ、のようなまとまりになるようにする：
   *  - 小さな切れ端（見出しの文字など）は、次（なければ前）のまとまりにくっつける
   *  - すき間がなく長すぎるまとまり（幅の2.2倍超）は、いちばん一色に近い行で切る
   */
  function segmentByGaps(w, h, blankRows, busyRows) {
    const n = blankRows.length;
    if (!n) return [{ sy: 0, sh: h }];
    const k = h / n; // 1行あたりの元の高さ
    const minGap = Math.max(1, Math.round(Math.max(12, w * 0.03) / k));
    // 中身のある範囲（すき間で区切られたもの）を集める
    const parts = [];
    let i = 0;
    while (i < n) {
      while (i < n && blankRows[i]) i++;
      if (i >= n) break;
      let j = i;
      let gap = 0;
      // 短いすき間（文字の行間など）は、まとまりの中とみなす
      while (j < n) {
        if (blankRows[j]) {
          gap++;
          if (gap >= minGap) break;
        } else gap = 0;
        j++;
      }
      const end = (j < n ? j + 1 : j) - gap; // すき間の手前まで
      parts.push({ sy: Math.round(i * k), ey: Math.round(end * k) });
      i = j;
    }
    // 小さな切れ端をくっつける（間のすき間ごと）
    const tiny = w * 0.06;
    const small = w * 0.3;
    const maxH = w * 2.2;
    const merged = [];
    for (let p = 0; p < parts.length; p++) {
      let cur = { ...parts[p] };
      const hh = cur.ey - cur.sy;
      if (hh < small && p + 1 < parts.length && parts[p + 1].ey - cur.sy <= maxH) {
        parts[p + 1] = { sy: cur.sy, ey: parts[p + 1].ey };
        continue;
      }
      if (hh < small && merged.length && cur.ey - merged[merged.length - 1].sy <= maxH) {
        merged[merged.length - 1].ey = cur.ey;
        continue;
      }
      if (hh < tiny) continue; // 細い線などは捨てる
      merged.push(cur);
    }
    // 長すぎるまとまりは、いちばん一色に近い行で切る
    const out = [];
    for (const m of merged) {
      const sh = m.ey - m.sy;
      if (sh <= maxH) {
        out.push({ sy: m.sy, sh });
        continue;
      }
      const a = Math.floor(m.sy / k);
      const b = Math.max(a + 1, Math.ceil(m.ey / k));
      const slice = busyRows ? busyRows.slice(a, b) : null;
      for (const t of tilePlan(w, sh, 8, slice && slice.length ? slice : null)) {
        out.push({ sy: m.sy + t.sy, sh: t.sh });
      }
    }
    return out;
  }

  /**
   * 各行が一色か（すき間か）と、行の「にぎやかさ」を調べる。細い線や小さな文字も拾えるよう、横128点で見る。
   * 返す rows は上から下まで等間隔に n 行。
   */
  function rowScan(source, w, h, n) {
    const W = 128;
    const H = Math.max(1, Math.min(n, h));
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(source, 0, 0, w, h, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const blank = [];
    const busy = [];
    for (let y = 0; y < H; y++) {
      let min = 255;
      let max = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      blank.push(max - min < 12);
      busy.push(max - min);
    }
    return { blank, busy };
  }

  /** 同じ幅の説明の画像を、上から順に1枚の長い画像につなぎ直す（高さは最大2万4千点まで） */
  function stitch(bitmaps) {
    const w = bitmaps[0].width;
    const scaled = bitmaps.map((b) => ({ b, h: Math.round((b.height * w) / b.width) }));
    const h = scaled.reduce((t, x) => t + x.h, 0);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    for (const x of scaled) {
      ctx.drawImage(x.b, 0, y, w, x.h);
      y += x.h;
    }
    return { canvas, w, h };
  }

  /** この大きさより小さい画像（アイコン・飾り）は使わない */
  const MIN_SIDE = 250;

  /** 薄いグレーで、商品が見えるくらいの透明度 */
  const WATERMARK_STYLE = { color: 'rgba(128, 128, 128, 0.35)', outline: 'rgba(255, 255, 255, 0.25)' };

  /** 画像の一部（crop）を、正方形・透かし入りの JPEG にする。ほぼ一色なら null */
  /**
   * 書き換える文字の位置の、まわりの色（いちばん多い明るさに近い色）。文字を消すときの塗りつぶしに使う
   */
  function surroundColor(ctx, x, y, w, h) {
    const pad = Math.max(2, Math.round(h * 0.15));
    const X = Math.max(0, Math.floor(x - pad));
    const Y = Math.max(0, Math.floor(y - pad));
    const W = Math.min(ctx.canvas.width - X, Math.ceil(w + pad * 2));
    const H = Math.min(ctx.canvas.height - Y, Math.ceil(h + pad * 2));
    if (W <= 0 || H <= 0) return [255, 255, 255];
    const d = ctx.getImageData(X, Y, W, H).data;
    const ring = [];
    for (let yy = 0; yy < H; yy++) {
      for (let xx = 0; xx < W; xx++) {
        const inside = xx >= pad && xx < W - pad && yy >= pad && yy < H - pad;
        if (inside) continue;
        const i = (yy * W + xx) * 4;
        ring.push([d[i], d[i + 1], d[i + 2]]);
      }
    }
    if (!ring.length) return [255, 255, 255];
    // 明るさで並べて、まん中の色（文字や線が少し入っても引っぱられない）
    ring.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    return ring[Math.floor(ring.length / 2)];
  }

  /**
   * 文字を日本語に書き換える。texts の位置は、描いた範囲（area）に対する割合（0〜1）。
   * 元の文字はまわりの色で消し、同じ場所に、入る大きさの日本語を書く。
   */
  function paintTexts(ctx, area, texts) {
    for (const t of texts || []) {
      if (!t || !t.ja) continue;
      const x = area.x + t.x * area.w;
      const y = area.y + t.y * area.h;
      const w = Math.max(4, t.w * area.w);
      const h = Math.max(4, t.h * area.h);
      const bg = surroundColor(ctx, x, y, w, h);
      const m = Math.max(1, h * 0.06);
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      ctx.fillRect(x - m, y - m, w + m * 2, h + m * 2);
      const light = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] > 140;
      ctx.fillStyle = light ? '#222222' : '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let size = Math.max(6, h * 0.95);
      const font = (px) => `500 ${px}px "Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif`;
      ctx.font = font(size);
      // 横幅に入るまで小さくする（元の幅より少しはみ出すのは許す）
      while (size > 6 && ctx.measureText(t.ja).width > Math.max(w * 1.15, h * 1.2)) {
        size -= 1;
        ctx.font = font(size);
      }
      ctx.fillText(t.ja, x, y + h / 2, Math.max(w * 1.3, h * 1.5));
    }
  }

  async function renderSquare(bmp, crop, maxPx, quality, watermark, texts) {
    const c = crop || { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height };
    if (crop) {
      // 切り分けたときだけ、ほぼ白いだけの部分を捨てる
      const probe = new OffscreenCanvas(16, 16);
      const pctx = probe.getContext('2d');
      pctx.drawImage(bmp, c.sx, c.sy, c.sw, c.sh, 0, 0, 16, 16);
      if (isBlankPixels(pctx.getImageData(0, 0, 16, 16).data)) return null;
    }
    const L = squareLayout(c.sw, c.sh, maxPx);
    const canvas = new OffscreenCanvas(L.side, L.side);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 余白と透過部分は白
    ctx.fillRect(0, 0, L.side, L.side);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, c.sx, c.sy, c.sw, c.sh, L.dx, L.dy, L.dw, L.dh);
    if (texts && texts.length) paintTexts(ctx, { x: L.dx, y: L.dy, w: L.dw, h: L.dh }, texts);
    if (watermark && watermark.trim()) {
      const W = watermarkLayout(L.side);
      ctx.font = `600 ${W.fontSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = Math.max(1, W.fontSize / 12);
      ctx.strokeStyle = WATERMARK_STYLE.outline;
      ctx.strokeText(watermark, W.x, W.y);
      ctx.fillStyle = WATERMARK_STYLE.color;
      ctx.fillText(watermark, W.x, W.y);
    }
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await out.arrayBuffer());
  }

  /** 画像1枚まるごとを正方形の JPEG にする（前からある使い方） */
  async function toJpeg(blob, maxPx, quality, watermark) {
    const bmp = await createImageBitmap(blob);
    try {
      return await renderSquare(bmp, null, maxPx, quality, watermark);
    } finally {
      if (bmp.close) bmp.close();
    }
  }

  async function loadUrl(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(String(res.status));
    return createImageBitmap(await res.blob());
  }

  /**
   * 画像を順に見て、BUYMA に入れる1枚ずつ（どの画像の・どの範囲か）を決める。決まるたびに take を呼ぶ。
   *  - 商品説明の画像が続くところ：同じ幅のものをつなぎ直し、白いすき間で「人1人・サイズ表1つ」ずつに分ける
   *  - メインの画像・色ごとの画像：1枚ずつ（とても長い画像だけ、白い帯で切る）
   * take(source, crop, parts, stitched) が true を返したら1枚として数える。limit 枚で止める。
   */
  async function walkImages(urls, opts, take, onProgress) {
    const limit = opts.limit || urls.length;
    const desc = new Set(opts.descUrls || []);
    const failed = [];
    let count = 0;
    let i = 0;
    while (i < urls.length && count < limit) {
      if (onProgress) onProgress(Math.min(count, limit), limit);
      if (desc.has(urls[i])) {
        const group = [];
        const parts = [];
        let j = i;
        let total = 0;
        while (j < urls.length && desc.has(urls[j])) {
          let b = null;
          try {
            b = await loadUrl(urls[j]);
          } catch (e) {
            failed.push(j + 1);
            j++;
            continue;
          }
          if (Math.max(b.width, b.height) < MIN_SIDE) {
            if (b.close) b.close();
            j++;
            continue;
          }
          const sameWidth = !group.length || Math.abs(group[0].width - b.width) <= 4;
          const h = group.length ? (b.height * group[0].width) / b.width : b.height;
          if (!sameWidth || total + h > 24000) {
            if (b.close) b.close();
            break; // 幅が違う・長すぎる → ここまででいったん区切る（この画像は次の回で扱う）
          }
          group.push(b);
          parts.push(urls[j]);
          total += h;
          j++;
        }
        if (group.length) {
          try {
            const { canvas, w, h } = stitch(group);
            const scan = rowScan(canvas, w, h, Math.min(6000, Math.ceil(h / 2)));
            for (const seg of segmentByGaps(w, h, scan.blank, scan.busy)) {
              if (count >= limit) break;
              if (await take(canvas, { sx: 0, sy: seg.sy, sw: w, sh: seg.sh }, parts, true)) count++;
            }
          } finally {
            for (const b of group) if (b.close) b.close();
          }
        }
        i = Math.max(j, i + 1);
        continue;
      }
      let bmp = null;
      try {
        bmp = await loadUrl(urls[i]);
        if (Math.max(bmp.width, bmp.height) >= MIN_SIDE) {
          const tall = bmp.height > bmp.width * 2;
          const tiles = tilePlan(bmp.width, bmp.height, opts.maxTiles || 4, tall ? rowProfile(bmp, 400) : null);
          for (const t of tiles) {
            if (count >= limit) break;
            if (await take(bmp, tiles.length > 1 ? t : null, [urls[i]], false)) count++;
          }
        }
      } catch (e) {
        failed.push(i + 1);
      } finally {
        if (bmp && bmp.close) bmp.close();
      }
      i++;
    }
    if (onProgress) onProgress(limit, limit);
    return failed;
  }

  /**
   * 画像を取って、正方形・透かし入りの JPEG にする（ZIP と「BUYMAに反映」の両方で使う）。
   * 小さいアイコンや、白いだけの部分は入れない。ファイル名の番号は、できた順の通し番号。
   * @returns {Promise<{files: {name: string, data: Uint8Array}[], failed: number[]}>} failed は 1 から数えた画像の番号
   */
  async function buildImageFiles(urls, itemId, opts, onProgress) {
    opts = opts || {};
    const maxPx = opts.maxPx || 1200;
    const quality = opts.quality || 0.9;
    const watermark = opts.watermark || '';
    const files = [];
    const failed = await walkImages(
      urls,
      opts,
      async (source, crop) => {
        const data = await renderSquare(source, crop, maxPx, quality, watermark);
        if (!data) return false;
        files.push({ name: imageFileName(itemId, files.length), data });
        return true;
      },
      onProgress
    );
    return { files, failed };
  }

  /**
   * BUYMA に入れる画像の「候補の一覧」を作る（拡張機能の画面に、最初からこの形で見せる）。
   * 1つずつ、どの画像の・どの範囲かと、小さな見本（thumb）を持つ。中身はあとで renderPlan で作る。
   */
  async function planImages(urls, opts, onProgress) {
    opts = opts || {};
    const thumbPx = opts.thumbPx || 120;
    const items = [];
    const failed = await walkImages(
      urls,
      opts,
      async (source, crop, parts, stitched) => {
        const data = await renderSquare(source, crop, thumbPx, 0.7, '');
        if (!data) return false;
        items.push({ parts: parts.slice(), stitched, crop: crop ? { ...crop } : null, thumb: 'data:image/jpeg;base64,' + bytesToBase64(data) });
        return true;
      },
      onProgress
    );
    return { items, failed };
  }

  /** 候補の一覧（planImages で作ったもの）から、本番の正方形 JPEG を作る。同じ元画像は1回だけ読み込む */
  async function renderPlan(items, itemId, opts, onProgress) {
    opts = opts || {};
    const maxPx = opts.maxPx || 1200;
    const quality = opts.quality || 0.9;
    const watermark = opts.watermark || '';
    const files = [];
    const failed = [];
    const cache = new Map();
    const sourceOf = async (item) => {
      const key = (item.stitched ? 's|' : 'b|') + item.parts.join('|');
      if (!cache.has(key)) {
        const bitmaps = [];
        for (const u of item.parts) bitmaps.push(await loadUrl(u));
        cache.set(key, { bitmaps, source: item.stitched ? stitch(bitmaps).canvas : bitmaps[0] });
      }
      return cache.get(key).source;
    };
    try {
      for (let k = 0; k < items.length; k++) {
        if (onProgress) onProgress(k, items.length);
        try {
          const it = items[k];
          const texts = it.translate !== false ? it.texts : null;
          const data = await renderSquare(await sourceOf(it), it.crop, maxPx, quality, watermark, texts);
          if (data) files.push({ name: imageFileName(itemId, files.length), data, index: k });
        } catch (e) {
          failed.push(k + 1);
        }
      }
    } finally {
      for (const v of cache.values()) for (const b of v.bitmaps) if (b.close) b.close();
    }
    if (onProgress) onProgress(items.length, items.length);
    return { files, failed };
  }

  /**
   * 候補の1枚ずつについて、画像の中の文字を読み取る（recognize は RakuImageText.createOcr の recognize）。
   * 文字の位置は、その1枚（正方形にする前の範囲）に対する割合（0〜1）で item.ocr に入れる。
   */
  async function ocrPlan(items, recognize, onProgress) {
    const cache = new Map();
    const sourceOf = async (item) => {
      const key = (item.stitched ? 's|' : 'b|') + item.parts.join('|');
      if (!cache.has(key)) {
        const bitmaps = [];
        for (const u of item.parts) bitmaps.push(await loadUrl(u));
        cache.set(key, { bitmaps, source: item.stitched ? stitch(bitmaps).canvas : bitmaps[0] });
      }
      return cache.get(key).source;
    };
    try {
      for (let k = 0; k < items.length; k++) {
        if (onProgress) onProgress(k, items.length);
        const it = items[k];
        try {
          const src = await sourceOf(it);
          const c = it.crop || { sx: 0, sy: 0, sw: src.width, sh: src.height };
          // 文字が読みやすい大きさ（横1000点くらい）にして読む
          const scale = Math.min(2, 1000 / c.sw);
          const cw = Math.max(1, Math.round(c.sw * scale));
          const ch = Math.max(1, Math.round(c.sh * scale));
          const canvas = new OffscreenCanvas(cw, ch);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(src, c.sx, c.sy, c.sw, c.sh, 0, 0, cw, ch);
          const lines = await recognize(canvas);
          it.ocr = lines.map((l) => ({
            text: l.text,
            confidence: l.confidence,
            x: l.bbox.x0 / cw,
            y: l.bbox.y0 / ch,
            w: (l.bbox.x1 - l.bbox.x0) / cw,
            h: (l.bbox.y1 - l.bbox.y0) / ch,
          }));
        } catch (e) {
          it.ocr = [];
        }
      }
    } finally {
      for (const v of cache.values()) for (const b of v.bitmaps) if (b.close) b.close();
    }
    if (onProgress) onProgress(items.length, items.length);
    return items;
  }

  /** 見本（小さな画像）を作り直す。日本語に書き換えたものを thumbJa に入れる */
  async function rethumb(items, thumbPx) {
    const out = await renderPlan(
      items.map((x) => ({ ...x, translate: true })),
      'thumb',
      { maxPx: thumbPx || 120, quality: 0.7 }
    );
    for (const f of out.files) items[f.index].thumbJa = 'data:image/jpeg;base64,' + bytesToBase64(f.data);
    return items;
  }

  /**
   * @returns {Promise<{zip: Uint8Array, ok: number, failed: number[]}>} failed は 1 から数えた番号
   */
  async function buildImagesZip(urls, itemId, opts, onProgress) {
    const { files, failed } = await buildImageFiles(urls, itemId, opts, onProgress);
    return { zip: root.BuymaZip.makeZip(files), ok: files.length, failed };
  }

  /** バイト列を、ほかの画面に渡せる文字（base64）にする */
  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  const api = { buildImagesZip, buildImageFiles, planImages, renderPlan, ocrPlan, rethumb, paintTexts, bytesToBase64, imageFileName, squareLayout, watermarkLayout, tilePlan, segmentByGaps, isBlankPixels, toJpeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
