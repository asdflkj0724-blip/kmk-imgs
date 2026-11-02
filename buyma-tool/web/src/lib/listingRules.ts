/**
 * BUYMA に出す文章のチェック。
 * 数値や単語は公式の最新ルールを確認して直すこと（ここは仮のたたき台）。
 */

/** 商品名の最大文字数（仮。BUYMA の出品画面に表示される上限に合わせて直す） */
export const TITLE_MAX = Number(process.env.BUYMA_TITLE_MAX || 60);
/** 商品説明の最大文字数（仮） */
export const DESCRIPTION_MAX = Number(process.env.BUYMA_DESCRIPTION_MAX || 3000);

export type IssueLevel = 'error' | 'warning';
export interface Issue {
  level: IssueLevel;
  field: 'title' | 'description' | 'source';
  word?: string;
  message: string;
}

/** 文字数（絵文字なども1文字として数える） */
export function charLength(s: string): number {
  return Array.from(s).length;
}

/** 上限を超えたら、区切り（スペース・記号）のところで切る */
export function fitTitle(title: string, max = TITLE_MAX): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join('');
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
  '最安', '激安', '日本未入荷', '日本未発売', '正規品保証', '100%', '絶対', '必ず', '送料無料', '即納', '在庫あり',
  '同款', '大牌', '明星同款', '网红',
];

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

export function checkListing(input: { title: string; description: string; sourceText?: string }): Issue[] {
  const issues: Issue[] = [];
  const { title, description, sourceText = '' } = input;

  if (!title.trim()) issues.push({ level: 'error', field: 'title', message: '商品名が空です' });
  if (charLength(title) > TITLE_MAX) {
    issues.push({ level: 'error', field: 'title', message: `商品名が${TITLE_MAX}文字を超えています（${charLength(title)}文字）` });
  }
  if (charLength(description) > DESCRIPTION_MAX) {
    issues.push({ level: 'error', field: 'description', message: `説明文が${DESCRIPTION_MAX}文字を超えています` });
  }

  for (const [field, text] of [['title', title], ['description', description]] as const) {
    for (const w of findWords(text, ERROR_WORDS)) {
      issues.push({ level: 'error', field, word: w, message: `「${w}」は使えません（偽物を思わせる表現）` });
    }
    for (const w of findWords(text, WARNING_WORDS)) {
      issues.push({ level: 'warning', field, word: w, message: `「${w}」は誇大表現や規約違反と取られることがあります` });
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
