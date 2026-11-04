/**
 * ホームページ（開発指示書 6.）。トップ → 悩み → 解決 → 機能 → 料金 → よくある質問 → 登録 → フッター の順。
 * 主役はメール登録。申し込み・購入ボタンは小さめに置く。名前・料金・連絡先は src/site.config.ts で決める。
 */
import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import './marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import EmailSignup from '@/components/EmailSignup';
import BuyButton from '@/components/BuyButton';
import { PLANS, TRIAL_DAYS, TRIAL_LIMIT } from '@/lib/plans';
import { SITE } from '@/site.config';

const yen = (n: number) => n.toLocaleString('ja-JP');
// デモ動画は public/demo.mp4 に置くと表示される（ない間は案内の箱を出す）
const hasDemo = fs.existsSync(path.join(process.cwd(), 'public', 'demo.mp4'));
const minPrice = Math.min(...Object.values(PLANS).map((p) => p.monthlyPriceJpy));
const waitlist = SITE.launchMode === 'waitlist';

/** 主役のボタン：完成前はメール登録、公開後は無料お試しのアカウント登録 */
function PrimaryCta({ compact = false }: { compact?: boolean }) {
  if (waitlist) return <EmailSignup source="waitlist" compact={compact} />;
  return (
    <p style={{ margin: '20px 0 8px' }}>
      <Link href="/login?mode=signup" className="btn">
        {TRIAL_DAYS}日間 無料で試す
      </Link>
    </p>
  );
}

/** 検索エンジン向けの、サービスの説明 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Chrome',
  description: SITE.description,
  offers: Object.values(PLANS).map((p) => ({ '@type': 'Offer', name: p.name, price: p.monthlyPriceJpy, priceCurrency: 'JPY' })),
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <SiteHeader />
      <main>
        {/* 1. トップ */}
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <h1>
                {/* 「、」の後ろで区切り、言葉の途中で改行しないようにする */}
                {SITE.catchcopy.split(/(?<=、)/).map((part) => (
                  <span key={part} className="phrase">
                    {part}
                  </span>
                ))}
                <span className="sub">{SITE.subcopy}</span>
              </h1>
              <p>
                タオバオ・天猫はもちろん、韓国や欧米の通販サイトでも。商品ページでボタンを押すだけで、AIが「翻訳」ではなく「そのまま出して売れる日本語」の商品名と説明文を書き、販売価格とカテゴリー候補までそろえます。
              </p>
              <div id="signup">
                <PrimaryCta />
              </div>
              <div className="buy-row">
                <span>すぐに使いたい方は</span>
                <BuyButton plan="standard" label="スタンダードプランを申し込む" />
                <Link href="#pricing">料金を見る</Link>
              </div>
            </div>
            <div className="demo-box" aria-label="デモ動画">
              {hasDemo ? (
                <video src="/demo.mp4" controls muted playsInline preload="metadata" aria-label={`${SITE.name}のデモ動画`} />
              ) : (
                <div className="demo-fallback">
                  <span className="demo-play" aria-hidden="true">▶</span>
                  <span>デモ動画（準備中）</span>
                  <span className="small">ボタンを押してから出品データができるまで</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 2. 悩み */}
        <section className="section section-soft">
          <div className="container">
            <h2>出品作業、こんなことで時間がかかっていませんか？</h2>
            <p className="section-lead">1件に20分、30分…。出品数が増えないのは、手作業が多すぎるからです。</p>
            <ul className="pain-list">
              <li>
                <strong>翻訳と説明文づくりが大変</strong>
                <br />
                中国語や外国語の仕様を読み解いて、売れそうな日本語の説明文を1件ずつ考えている
              </li>
              <li>
                <strong>価格計算が面倒</strong>
                <br />
                為替・送料・手数料・利益を、毎回電卓や表計算で計算している
              </li>
              <li>
                <strong>画像の保存が手間</strong>
                <br />
                商品画像を1枚ずつ保存して、名前を付けて、大きさを直している
              </li>
            </ul>
          </div>
        </section>

        {/* 3. 解決 */}
        <section className="section">
          <div className="container">
            <h2>ボタンを押すだけで、出品の準備がそろいます</h2>
            <p className="section-lead">情報の取り込みから、売れる文章・価格・カテゴリー候補まで、AIがまとめて用意します。</p>
            <ol className="steps">
              <li>
                <h3>商品ページで、ボタンを押す</h3>
                <p>仕入れたい商品のページ（タオバオ・天猫・韓国や欧米の通販サイトなど）で、Chromeのボタンを押します。商品名・価格・色・サイズ・画像を読み取ります。</p>
              </li>
              <li>
                <h3>AIが、売れる日本語に</h3>
                <p>読み取った内容を確かめたら、AIが検索されやすい商品名と、そのまま出して売れる説明文を書きます。販売価格の計算と、カテゴリーの候補も同時にできあがります。</p>
              </li>
              <li>
                <h3>コピーして、BUYMAへ</h3>
                <p>できあがった項目を1つずつコピーして、BUYMAの出品画面に貼り付けます。内容を確かめたら、最後の「出品する」はご自身で押します。</p>
              </li>
            </ol>
            <div className="semi-auto">
              <strong>規約を守った、安心の半自動です。</strong>
              <br />
              BUYMAの画面を機械で自動操作することはしません。AIが用意するのは出品データまでで、BUYMAへの入力と出品は、ご自身で確認して行います。
            </div>
          </div>
        </section>

        {/* 4. 機能の紹介 */}
        <section className="section section-soft" id="features">
          <div className="container">
            <h2>機能の紹介</h2>
            <p className="section-lead">出品に必要な作業を、1つのツールでまとめて。</p>
            <div className="grid grid-3">
              <div className="feature feature-main">
                <h3>売れる商品名・説明文をAIが作成</h3>
                <p>
                  ただの翻訳ではなく、検索されやすい商品名と、素材・デザイン・サイズ感が伝わる説明文を、自然な日本語で作ります。言い回しは「ていねい」「カジュアル」から選べます。
                </p>
              </div>
              <div className="feature">
                <h3>どの通販サイトでも読み取れる</h3>
                <p>タオバオ・天猫・1688はもちろん、韓国や欧米の通販サイトでも。中国語・英語・韓国語・イタリア語・フランス語など、元の言語は問いません。</p>
              </div>
              <div className="feature">
                <h3>販売価格とカテゴリー候補</h3>
                <p>仕入れ値・為替・送料・手数料・利益率から販売価格を計算します。BUYMAのカテゴリーの候補も一緒に出します。</p>
              </div>
              <div className="feature">
                <h3>BUYMAの項目ごとにコピー</h3>
                <p>タイトル・説明文・価格・カテゴリー候補・色・サイズ・ブランド・配送方法を、項目ごとにコピーして貼り付けるだけです。</p>
              </div>
              <div className="feature">
                <h3>禁止ワードのチェック</h3>
                <p>誇大な表現や、偽物を思わせる言葉、ブランド名の扱いを出品前にお知らせします。中国語の文字が残っていても気づけます。</p>
              </div>
              <div className="feature">
                <h3>画像ZIP・CSV・出品履歴</h3>
                <p>画像は大きさと名前をそろえて、まとめてダウンロードできます。作った出品データは一覧で管理できます。</p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. 料金表 */}
        <section className="section" id="pricing">
          <div className="container">
            <h2>料金プラン</h2>
            <p className="section-lead">
              出品件数に合わせて選べる段階制。月{yen(minPrice)}円のミニから、年払いなら2か月分お得です。
            </p>
            <p className="value-note">
              <strong>翻訳だけで終わりません。</strong>
              そのまま出して売れる商品名・説明文に、販売価格とカテゴリー候補まで。出品にかかる時間を、1件数分に短くします。
            </p>
            <div className="price-grid">
              {Object.values(PLANS).map((p) => (
                <div key={p.id} className={`price-card${p.highlight ? ' highlight' : ''}`}>
                  {p.highlight && <span className="price-tag">おすすめ</span>}
                  <h3>{p.name}</h3>
                  <div className="price-amount">
                    {yen(p.monthlyPriceJpy)}
                    <small>円／月</small>
                  </div>
                  <p className="small muted" style={{ margin: 0 }}>
                    年払い {yen(p.yearlyPriceJpy)}円（2か月分お得）
                  </p>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <div className="buy-row">
                    <BuyButton plan={p.id} label="このプランを申し込む" />
                  </div>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>
              まずは無料で：{TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで、すべての機能を試せます（カード登録なし）。{' '}
              <Link href="#signup">無料お試しに登録する</Link>
            </p>
            <p className="small muted">
              月{yen(SITE.customAbove)}件を超える場合は、<Link href="/contact">お問い合わせ</Link>から個別にご相談ください。価格はすべて税込です。紹介制度：お友だちを紹介すると、紹介した人もされた人も1か月無料になります。
            </p>
          </div>
        </section>

        {/* 6. よくある質問 */}
        <section className="section section-soft">
          <div className="container">
            <h2>よくある質問</h2>
            <dl className="faq">
              {waitlist && (
                <>
                  <dt>登録したら、すぐに使えますか？</dt>
                  <dd>ただいま公開の準備中です。準備ができしだい、ご登録のメールアドレスに無料お試しのご案内をお送りします。</dd>
                </>
              )}
              <dt>ただの翻訳ツールと何が違いますか？</dt>
              <dd>翻訳だけでなく、BUYMAで検索されやすい商品名と、そのまま出して売れる説明文まで作ります。販売価格とカテゴリー候補も一緒にそろいます。</dd>
              <dt>BUYMAへの出品まで自動ですか？</dt>
              <dd>いいえ。BUYMAの規約を守るため、BUYMAの画面の自動操作はしません。用意した項目をコピーして貼り付け、最後の「出品する」はご自身で押していただきます。</dd>
              <dt>BUYMAやタオバオの公式ツールですか？</dt>
              <dd>いいえ、公式ツールではありません。各サイトの規約を守ってご利用ください。</dd>
              <dt>解約はいつでもできますか？</dt>
              <dd>はい。管理画面からいつでも解約できます。解約後も、お支払い済みの期間の終わりまで使えます。</dd>
            </dl>
            <p style={{ marginTop: 20 }}>
              <Link href="/faq">よくある質問をもっと見る →</Link>
            </p>
          </div>
        </section>

        {/* 7. 無料お試しのメール登録（主役）と、申し込み・購入ボタン */}
        <section className="section">
          <div className="container">
            <div className="cta-band">
              <h2>まずは無料で、出品のラクさを体験してください</h2>
              <p>
                {TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで無料。メールアドレスだけで登録できます。
              </p>
              <PrimaryCta compact />
              <div className="buy-row" style={{ justifyContent: 'center' }}>
                <span>すぐに使いたい方は</span>
                <BuyButton plan="standard" label="スタンダードプランを申し込む" />
              </div>
              <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
                はじめての方は <Link href="/guide">BUYMAの始め方 無料ガイド</Link> もどうぞ。
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
