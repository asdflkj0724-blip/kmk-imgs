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
   * 切り出す範囲。縦に長い画像（商品説明の画像など）は、幅と同じ高さの正方形に上から切り分ける。
   * 最後の小さな切れ端（幅の3割未満）は捨てる。1枚から切り出すのは maxTiles 枚まで。
   * 縦長でない画像は、そのまま1枚（正方形にするときは白い余白を足す）。
   */
  function tilePlan(w, h, maxTiles) {
    const max = maxTiles || 4;
    if (!(h > w * 1.3)) return [{ sx: 0, sy: 0, sw: w, sh: h }];
    const tiles = [];
    for (let sy = 0; sy < h && tiles.length < max; sy += w) {
      const sh = Math.min(w, h - sy);
      if (sh < w * 0.3) break;
      tiles.push({ sx: 0, sy, sw: w, sh });
    }
    return tiles;
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

  /** この大きさより小さい画像（アイコン・飾り）は使わない */
  const MIN_SIDE = 250;

  /** 薄いグレーで、商品が見えるくらいの透明度 */
  const WATERMARK_STYLE = { color: 'rgba(128, 128, 128, 0.35)', outline: 'rgba(255, 255, 255, 0.25)' };

  /** 画像の一部（crop）を、正方形・透かし入りの JPEG にする。ほぼ一色なら null */
  async function renderSquare(bmp, crop, maxPx, quality, watermark) {
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

  /**
   * 画像を取って、正方形・透かし入りの JPEG にする（ZIP と「BUYMAに反映」の両方で使う）。
   * 縦に長い画像（商品説明・サイズ表など）は正方形に切り分け、limit 枚（BUYMA は20枚）に近づくまで入れる。
   * 小さいアイコンや、白いだけの部分は入れない。ファイル名の番号は、できた順の通し番号。
   * @returns {Promise<{files: {name: string, data: Uint8Array}[], failed: number[]}>} failed は 1 から数えた画像の番号
   */
  async function buildImageFiles(urls, itemId, opts, onProgress) {
    opts = opts || {};
    const maxPx = opts.maxPx || 1200;
    const quality = opts.quality || 0.9;
    const watermark = opts.watermark || '';
    const limit = opts.limit || urls.length;
    const files = [];
    const failed = [];
    for (let i = 0; i < urls.length && files.length < limit; i++) {
      if (onProgress) onProgress(Math.min(files.length, limit), limit);
      let bmp = null;
      try {
        const res = await fetch(urls[i], { credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        bmp = await createImageBitmap(await res.blob());
        if (Math.max(bmp.width, bmp.height) < MIN_SIDE) continue; // アイコンなど
        const tiles = tilePlan(bmp.width, bmp.height, opts.maxTiles || 4);
        for (const t of tiles) {
          if (files.length >= limit) break;
          const data = await renderSquare(bmp, tiles.length > 1 ? t : null, maxPx, quality, watermark);
          if (data) files.push({ name: imageFileName(itemId, files.length), data });
        }
      } catch (e) {
        failed.push(i + 1);
      } finally {
        if (bmp && bmp.close) bmp.close();
      }
    }
    if (onProgress) onProgress(limit, limit);
    return { files, failed };
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

  const api = { buildImagesZip, buildImageFiles, bytesToBase64, imageFileName, squareLayout, watermarkLayout, tilePlan, isBlankPixels, toJpeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
