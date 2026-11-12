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

  /** 薄いグレーで、商品が見えるくらいの透明度 */
  const WATERMARK_STYLE = { color: 'rgba(128, 128, 128, 0.35)', outline: 'rgba(255, 255, 255, 0.25)' };

  async function toJpeg(blob, maxPx, quality, watermark) {
    const bmp = await createImageBitmap(blob);
    const L = squareLayout(bmp.width, bmp.height, maxPx);
    const canvas = new OffscreenCanvas(L.side, L.side);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 余白と透過部分は白
    ctx.fillRect(0, 0, L.side, L.side);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, L.dx, L.dy, L.dw, L.dh);
    if (bmp.close) bmp.close();
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

  /**
   * @returns {Promise<{zip: Uint8Array, ok: number, failed: number[]}>} failed は 1 から数えた番号
   */
  async function buildImagesZip(urls, itemId, opts, onProgress) {
    opts = opts || {};
    const maxPx = opts.maxPx || 1200;
    const quality = opts.quality || 0.9;
    const watermark = opts.watermark || '';
    const files = [];
    const failed = [];
    for (let i = 0; i < urls.length; i++) {
      if (onProgress) onProgress(i, urls.length);
      try {
        const res = await fetch(urls[i], { credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await toJpeg(await res.blob(), maxPx, quality, watermark);
        // 失敗した画像があっても番号はずらさない（CSV の並びと合わせるため）
        files.push({ name: imageFileName(itemId, i), data });
      } catch (e) {
        failed.push(i + 1);
      }
    }
    if (onProgress) onProgress(urls.length, urls.length);
    return { zip: root.BuymaZip.makeZip(files), ok: files.length, failed };
  }

  const api = { buildImagesZip, imageFileName, squareLayout, watermarkLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
