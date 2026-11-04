/**
 * サイトの設定（仮の名前・料金・連絡先）。決まったら、このファイルだけ直せば全体に反映されます。
 * 開発指示書 6.「仮の名前・料金・連絡先は1か所の設定ファイルにまとめ、あとで差し替えやすくする」
 */

export const SITE = {
  /** サービス名（仮） */
  name: 'ラク出品AI',
  /** キャッチコピー（1行目・2行目） */
  catchcopy: '中国・海外の商品を、そのまま出して売れる日本語に。',
  subcopy: 'BUYMAへの出品がラクになる',
  /**
   * 検索結果に出るページの題名（名前の後ろに付く説明）。
   * サービス名に「BUYMA」は入れず、ここで「何に使うツールか」として書く（BUYMA の商標を名乗らないため）
   */
  seoTitle: 'BUYMAの出品データをAIで自動作成｜タオバオ・海外通販から売れる日本語に',
  /** 検索されやすい言葉（ページの説明に自然に入れる） */
  keywords: ['BUYMA 出品', 'BUYMA 出品 ツール', 'BUYMA 出品 効率化', 'タオバオ BUYMA', 'BUYMA 商品説明', 'BUYMA 翻訳', 'パーソナルショッパー'],
  /** 検索結果などに出る説明文 */
  description:
    'BUYMAのパーソナルショッパー向け出品支援ツール。タオバオや海外通販の商品ページでボタンを押すだけで、AIが売れる日本語の商品名・説明文、販売価格、カテゴリー候補まで自動で作成します。BUYMAの公式ツールではありません。',

  /**
   * 公開のしかた
   * - 'waitlist'：ツールの完成前。メール登録（興味がある人を集める）を主役にする
   * - 'open'：ツールの公開後。ボタンから無料お試しのアカウント登録へ進む
   */
  launchMode: 'waitlist' as 'waitlist' | 'open',

  /** 無料お試し */
  trial: { days: 7, limit: 10 },

  /** 料金（Stripe の価格もこの金額で作る。年額は2か月分お得＝月額×10） */
  plans: {
    mini: { name: 'ミニ', monthly: 980, yearly: 9800, limit: 30 },
    light: { name: 'ライト', monthly: 2480, yearly: 24800, limit: 100 },
    standard: { name: 'スタンダード', monthly: 3980, yearly: 39800, limit: 500 },
    pro: { name: 'プロ', monthly: 5980, yearly: 59800, limit: 1000 },
  },
  /** これより多く使いたい人は個別に相談 */
  customAbove: 1000,

  /**
   * 連絡先・特定商取引法の表記。公開前に必ず実際の情報にする。
   * Vercel の環境変数（NEXT_PUBLIC_SELLER_*）を入れた場合は、そちらが優先されます。
   */
  seller: {
    name: process.env.NEXT_PUBLIC_SELLER_NAME || '',
    manager: process.env.NEXT_PUBLIC_SELLER_MANAGER || '',
    address: process.env.NEXT_PUBLIC_SELLER_ADDRESS || '',
    phone: process.env.NEXT_PUBLIC_SELLER_PHONE || '',
    email: process.env.NEXT_PUBLIC_SELLER_EMAIL || '',
  },
} as const;

export type PaidPlanKey = keyof typeof SITE.plans;
