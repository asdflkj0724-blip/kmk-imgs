/*
 * 画像の中の外国語（中国語など）を見つけて、日本語に書き換えるための部品。
 * - 文字の読み取りは拡張機能の中だけで行う（無料。vendor/tesseract。画像は外に送らない）
 * - 翻訳は、読み取った文字だけをラク出品のサーバーに送る
 */
(function (root) {
  'use strict';

  const HAN = /\p{Script=Han}/u;
  const KANA = /[\u3040-\u30ff]/;
  const HANGUL = /\p{Script=Hangul}/u;

  /** 読み取った文字を整える：漢字どうしの間に入った空白を詰める */
  function cleanOcrText(t) {
    return String(t || '')
      .replace(/\s+/g, ' ')
      .replace(/(\p{Script=Han}|[：:，,。])\s+(?=\p{Script=Han}|[：:，,。])/gu, '$1')
      .replace(/^[\s“”"'‘’「」|｜_~`]+|[\s“”"'‘’「」|｜_~`]+$/g, '') // 読み取りのゴミ（引用符・縦線など）
      .trim();
  }

  /** サイズ・数字・記号だけの行は書き換えない（S / M / 58 / 110cm など） */
  const SIZE_ONLY = /^[\sA-Za-z0-9.,:;/\\()（）\-+*%~〜±×xX]*$/;
  const SIZE_WORD = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|F|FREE|ONE|SIZE|CM|MM|KG|G|ML|M2|NO|ID)$/i;

  /**
   * 書き換えが必要な行か：中国語・韓国語を含む、または意味のある英単語（3文字以上）を含む。
   * すでに日本語（ひらがな・カタカナ入り）の行や、自信の低い読み取り（写真の模様を文字と読んだもの）は除く。
   */
  function needsTranslation(text, confidence) {
    const t = cleanOcrText(text);
    if (!t || t.length < 2) return false;
    if (KANA.test(t)) return false;
    // 漢字は1字ずつの自信が低めに出るので、ゆるめに拾う（意味のない読み取りは、翻訳のときに外す）
    if (HAN.test(t) || HANGUL.test(t)) return (confidence == null || confidence >= 20) && (t.match(/\p{Script=Han}|\p{Script=Hangul}/gu) || []).length >= 2;
    if (SIZE_ONLY.test(t)) {
      const words = t.match(/[A-Za-z]{3,}/g) || [];
      if (!words.filter((w) => !SIZE_WORD.test(w)).length) return false;
    }
    return (confidence == null || confidence >= 70) && /[A-Za-z]{3,}/.test(t);
  }

  /**
   * 1行の中で、大きくあいたところ（表の列の間など）で区切る。列ごとに訳して、同じ位置に書けるようにする。
   * line は Tesseract の行（words に1語ずつの位置がある）。
   */
  function splitByGaps(line) {
    const words = (line.words || []).filter((w) => w.text && w.text.trim());
    if (!words.length) return [{ text: cleanOcrText(line.text), confidence: line.confidence, bbox: line.bbox }];
    const lh = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const chunks = [];
    let cur = null;
    for (const w of words) {
      if (cur && w.bbox.x0 - cur.bbox.x1 <= lh * 0.9) {
        cur.parts.push(w);
        cur.bbox = { x0: Math.min(cur.bbox.x0, w.bbox.x0), y0: Math.min(cur.bbox.y0, w.bbox.y0), x1: Math.max(cur.bbox.x1, w.bbox.x1), y1: Math.max(cur.bbox.y1, w.bbox.y1) };
      } else {
        cur = { parts: [w], bbox: { ...w.bbox } };
        chunks.push(cur);
      }
    }
    return chunks.map((c) => ({
      text: cleanOcrText(c.parts.map((w) => w.text).join(' ')),
      confidence: c.parts.reduce((t, w) => t + (w.confidence || 0), 0) / c.parts.length,
      bbox: c.bbox,
    }));
  }

  /**
   * 文字の読み取り係（使い終わったら terminate）。recognize(canvas) で、行ごとの文字と位置（canvas の点）を返す。
   */
  async function createOcr(base) {
    const T = root.Tesseract;
    if (!T) throw new Error('文字を読む道具が読み込まれていません');
    const dir = (base || '') + 'vendor/tesseract/';
    const worker = await T.createWorker('chi_sim', 1, {
      workerPath: dir + 'worker.min.js',
      corePath: dir + 'tesseract-core-simd-lstm.wasm.js',
      langPath: dir.replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
    });
    return {
      async recognize(canvas) {
        const res = await worker.recognize(canvas, {}, { blocks: true });
        const out = [];
        for (const b of res.data.blocks || []) {
          for (const p of b.paragraphs || []) {
            for (const l of p.lines || []) out.push(...splitByGaps(l));
          }
        }
        return out;
      },
      terminate: () => worker.terminate(),
    };
  }

  const api = { cleanOcrText, needsTranslation, splitByGaps, createOcr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RakuImageText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
