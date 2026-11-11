/*
 * 商品画像をまとめて取り、大きさをそろえて ZIP にする（ポップアップで使う）。
 * ファイル名は taobao_<商品ID>_01.jpg …（管理画面の CSV と同じ付け方。変えないこと）
 */
(function (root) {
  'use strict';

  function imageFileName(itemId, index) {
    return `taobao_${itemId || 'item'}_${String(index + 1).padStart(2, '0')}.jpg`;
  }

  async function toJpeg(blob, maxPx, quality) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height)); // 拡大はしない
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 透過部分は白にする
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
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
    const files = [];
    const failed = [];
    for (let i = 0; i < urls.length; i++) {
      if (onProgress) onProgress(i, urls.length);
      try {
        const res = await fetch(urls[i], { credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await toJpeg(await res.blob(), maxPx, quality);
        // 失敗した画像があっても番号はずらさない（CSV の並びと合わせるため）
        files.push({ name: imageFileName(itemId, i), data });
      } catch (e) {
        failed.push(i + 1);
      }
    }
    if (onProgress) onProgress(urls.length, urls.length);
    return { zip: root.BuymaZip.makeZip(files), ok: files.length, failed };
  }

  root.BuymaImages = { buildImagesZip, imageFileName };
})(typeof globalThis !== 'undefined' ? globalThis : this);
