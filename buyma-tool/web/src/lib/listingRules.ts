/**
 * BUYMA に出す文章のチェック。
 * 数値や単語は公式の最新ルールを確認して直すこと（ここは仮のたたき台）。
 */

/** 商品名の最大文字数（仮。BUYMA の出品画面に表示される上限に合わせて直す） */
export const TITLE_MAX = Number(process.env.BUYMA_TITLE_MAX || 60);
/** 商品説明の最大文字数（仮） */
export const DESCRIPTION_MAX = Number(process.env.BUYMA_DESCRIPTION_MAX || 3000);

/** error＝出品前に必ず直す（致命的） / warning＝確認が必要 / info＝情報が足りないだけ */
export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  field: 'title' | 'description' | 'source';
  word?: string;
  message: string;
}

/** 1文字の幅：半角（英数字・記号・半角カナ）は1、それ以外（日本語など全角）は2 */
function charWidth(c: string): number {
  const code = c.codePointAt(0) ?? 0;
  return code <= 0x7e || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
}

/**
 * BUYMA の数え方の文字数（半角換算）。BUYMA の出品画面は「あと60文字(半角)」のように、
 * 半角を1・全角を2として数える。日本語の商品名は30文字までになる。
 */
export function charLength(s: string): number {
  let n = 0;
  for (const c of Array.from(s)) n += charWidth(c);
  return n;
}

/** 上限を超えたら、区切り（スペース・記号）のところで切る（半角換算で数える） */
export function fitTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  if (charLength(t) <= max) return t;
  let cut = '';
  let n = 0;
  for (const c of Array.from(t)) {
    if (n + charWidth(c) > max) break;
    cut += c;
    n += charWidth(c);
  }
  const m = cut.match(/^(.*)[\s　\/／・|｜【】「」()（）-]/);
  const result = m && charLength(m[1]) >= max * 0.6 ? m[1] : cut;
  return result.trim();
}

/** 出品してはいけない・誤解を招く言葉（偽物を思わせる表現など） */
const ERROR_WORDS = [
  'コピー品', 'スーパーコピー', 'レプリカ', '偽物', 'N級', 'S級品', 'ミラー品', 'ノベルティ', '並行輸入品ではありません',
  '高仿', '复刻', '原单', '仿品', 'A货', '1:1',
];

/** BUYMA のルールに引っかかりやすい、または誇大と取られやすい言葉 */
const WARNING_WORDS = [
  '日本未入荷', '日本未発売', '正規品保証', '100%正規品', '絶対', '送料無料', '即納', '在庫あり',
  '同款', '大牌', '明星同款', '网红',
];

/**
 * 根拠のない誇大表現は、警告を出すのではなく自動で消す（「高級感」のような見た目の説明は残す）。
 * label は「自動で直したこと」の表示に使う。
 */
const AUTO_REMOVE: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:最高級|超高級)(?:な|の)?/g, label: '最高級' },
  { pattern: /高級(?!感)(?:な|の)?/g, label: '高級' },
  { pattern: /(?:大人気|爆売れ|人気No\.?\s?1|人気ナンバーワン)(?:の)?/gi, label: '大人気' },
  { pattern: /(?:激安|最安値|最安|格安)(?:の)?/g, label: '激安・最安' },
  { pattern: /(?:高品質|ハイクオリティ)(?:な|の)?/g, label: '高品質' },
];

/** 誇大表現を消し、消したもの（label）を返す */
export function autoFixText(text: string, isTitle = false): { text: string; removed: string[] } {
  const removed: string[] = [];
  let out = text;
  for (const { pattern, label } of AUTO_REMOVE) {
    if (pattern.test(out)) {
      removed.push(label);
      out = out.replace(pattern, '');
    }
    pattern.lastIndex = 0;
  }
  if (removed.length) {
    out = out
      .replace(/【\s*】|「\s*」|（\s*）|\(\s*\)/g, '')
      .replace(/[ 　]{2,}/g, ' ')
      .replace(/^[ 　・、,]+/gm, '');
    if (isTitle) out = out.replace(/\s+/g, ' ').trim();
  }
  return { text: out, removed };
}

/** 有名ブランド名（ブランド品は正規品の確認が必要。ここは代表例） */
const BRANDS = [
  'CHANEL', 'シャネル', 'LOUIS VUITTON', 'ルイヴィトン', 'ルイ・ヴィトン', 'HERMES', 'エルメス', 'GUCCI', 'グッチ',
  'PRADA', 'プラダ', 'Dior', 'ディオール', 'CELINE', 'セリーヌ', 'BALENCIAGA', 'バレンシアガ', 'Burberry', 'バーバリー',
  'MONCLER', 'モンクレール', 'Supreme', 'シュプリーム', 'NIKE', 'ナイキ', 'adidas', 'アディダス', 'Miu Miu', 'ミュウミュウ',
  'Loewe', 'ロエベ', 'Bottega Veneta', 'ボッテガ', 'Fendi', 'フェンディ', 'Saint Laurent', 'サンローラン',
  '香奈儿', '路易威登', '爱马仕', '古驰', '普拉达', '迪奥', '思琳', '巴黎世家', '博柏利', '盟可睐', '耐克', '阿迪达斯',
];

function findWords(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

/** 日本語にはない、中国語（簡体字）でよく使う文字 */
const SIMPLIFIED_ONLY = '码颜这们么时发东车长门问开关买卖级货质类价优纯线纹领袜裤衬织绒针轻显宽简设计说际专业红爱览鲜';

/** 簡体字が残っていないか調べる。見つかった文字を返す */
export function findSimplifiedChinese(text: string): string[] {
  return Array.from(new Set(Array.from(text).filter((c) => SIMPLIFIED_ONLY.includes(c))));
}

export function checkListing(input: { title: string; description: string; sourceText?: string }): Issue[] {
  const issues: Issue[] = [];
  const { title, description, sourceText = '' } = input;

  if (!title.trim()) issues.push({ level: 'error', field: 'title', message: '商品名が空です' });
  if (charLength(title) > TITLE_MAX) {
    issues.push({ level: 'error', field: 'title', message: `商品名が長すぎます（BUYMA の上限は半角${TITLE_MAX}文字＝全角${TITLE_MAX / 2}文字。今は半角換算で${charLength(title)}文字）` });
  }
  if (charLength(description) > DESCRIPTION_MAX) {
    issues.push({ level: 'error', field: 'description', message: `商品コメントが長すぎます（上限は半角${DESCRIPTION_MAX}文字＝全角${DESCRIPTION_MAX / 2}文字）` });
  }

  for (const [field, text] of [['title', title], ['description', description]] as const) {
    for (const w of findWords(text, ERROR_WORDS)) {
      issues.push({ level: 'error', field, word: w, message: `「${w}」は使えません（偽物を思わせる表現）` });
    }
    for (const w of findWords(text, WARNING_WORDS)) {
      issues.push({ level: 'warning', field, word: w, message: `「${w}」は誇大表現や規約違反と取られることがあります` });
    }
  }

  for (const [field, text] of [['title', title], ['description', description]] as const) {
    const zh = findSimplifiedChinese(text);
    if (zh.length) {
      issues.push({
        level: 'warning',
        field,
        word: zh.join(''),
        message: `中国語の文字（${zh.join('・')}）が残っています。日本語に直してください`,
      });
    }
  }

  // 仕入れ元の文章に偽物を思わせる言葉があれば強く注意する
  for (const w of findWords(sourceText, ERROR_WORDS)) {
    issues.push({ level: 'error', field: 'source', word: w, message: `仕入れ元に「${w}」とあります。偽物の可能性が高いので出品しないでください` });
  }
  for (const w of findWords(sourceText, ['同款', '大牌', '明星同款'])) {
    issues.push({ level: 'warning', field: 'source', word: w, message: `仕入れ元に「${w}」（〇〇風・似たデザインの意味）とあります。ブランド名を書かないでください` });
  }

  const brands = new Set([...findWords(title, BRANDS), ...findWords(description, BRANDS)]);
  for (const b of brands) {
    issues.push({
      level: 'warning',
      field: 'title',
      word: b,
      message: `ブランド名「${b}」が入っています。正規品だと確認できる場合だけ使ってください`,
    });
  }
  return issues;
}
