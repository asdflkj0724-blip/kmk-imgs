/*
 * 圧縮なし（STORE）の ZIP を作る。JPEG はもともと圧縮済みなので、これで十分。
 * 外部ライブラリを使わない。
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new Error('ZIP に入れられないデータです');
  }

  /** @param files [{name: string, data: Uint8Array|ArrayBuffer|string, date?: Date}] */
  function makeZip(files) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = toBytes(f.data);
      const crc = crc32(data);
      const { time, date } = dosDateTime(f.date || new Date());

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // 展開に必要なバージョン
      lv.setUint16(6, 0x0800, true); // ファイル名は UTF-8
      lv.setUint16(8, 0, true); // STORE
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);

      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centrals.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const parts = [...locals, ...centrals, end];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  const api = { makeZip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuymaZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
