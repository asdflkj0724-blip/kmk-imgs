/**
 * 販売価格の「計算式」。表示価格（円）を x として計算する。
 *   ×1.3+2000 → x×1.3+2000 / +3000 → x+3000 / 3000（数字だけ）→ x+3000 / (x+500)×1.2
 * 使える記号：数字・x・＋－×÷（+ - * /）・かっこ。ほかの文字は使えない（安全のため eval は使わない）。
 */
export const PRICE_EXPR_MAX = 60;

/** 全角や記号の違いをそろえ、「×1.3+2000」のように x が省かれていたら先頭に x を補う */
export function normalizePriceExpr(raw: string): string {
  let s = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[×xＸX✕]/g, (c) => (c === 'x' || c === 'X' ? 'x' : '*'))
    .replace(/[÷]/g, '/')
    .replace(/[−ー―‐]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/表示価格|価格|円/g, (m) => (m === '円' ? '' : 'x'));
  if (!s) return '';
  if (/^[0-9.]+$/.test(s)) return `x+${s}`; // 数字だけなら「＋その金額」
  if (/^[+\-*/]/.test(s)) s = 'x' + s;
  return s;
}

type Tok = { t: 'n'; v: number } | { t: 'x' } | { t: 'op'; v: string } | { t: '(' } | { t: ')' };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error('式の数字が正しくありません');
      out.push({ t: 'n', v });
      i = j;
    } else if (c === 'x') {
      out.push({ t: 'x' });
      i++;
    } else if ('+-*/'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else if (c === '(') {
      out.push({ t: '(' });
      i++;
    } else if (c === ')') {
      out.push({ t: ')' });
      i++;
    } else {
      throw new Error(`式に使えない文字があります（${c}）`);
    }
  }
  return out;
}

/** 式を計算する。x は表示価格（円）。式が正しくなければ、わかりやすい言葉でエラーにする */
export function evalPriceExpr(raw: string, x: number): number {
  const s = normalizePriceExpr(raw);
  if (!s) throw new Error('計算式が空です');
  if (s.length > PRICE_EXPR_MAX) throw new Error(`計算式が長すぎます（${PRICE_EXPR_MAX}文字まで）`);
  const toks = tokenize(s);
  let p = 0;
  const peek = () => toks[p];
  const expr = (): number => {
    let v = term();
    while (peek() && peek().t === 'op' && ((peek() as { v: string }).v === '+' || (peek() as { v: string }).v === '-')) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() && peek().t === 'op' && ((peek() as { v: string }).v === '*' || (peek() as { v: string }).v === '/')) {
      const op = (toks[p++] as { v: string }).v;
      const r = factor();
      if (op === '/' && r === 0) throw new Error('0 で割ることはできません');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const t = toks[p++];
    if (!t) throw new Error('式が途中で終わっています');
    if (t.t === 'n') return t.v;
    if (t.t === 'x') return x;
    if (t.t === 'op' && t.v === '-') return -factor();
    if (t.t === '(') {
      const v = expr();
      if (!toks[p] || toks[p].t !== ')') throw new Error('かっこが閉じていません');
      p++;
      return v;
    }
    throw new Error('式が正しくありません');
  };
  const v = expr();
  if (p !== toks.length) throw new Error('式が正しくありません');
  if (!Number.isFinite(v)) throw new Error('式の答えが数字になりません');
  return v;
}

/** 式が正しいか（エラーの説明。正しければ null） */
export function priceExprError(raw: string): string | null {
  try {
    evalPriceExpr(raw, 1000);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
