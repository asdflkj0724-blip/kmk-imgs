import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import './marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { PLANS, TRIAL_DAYS, TRIAL_LIMIT } from '@/lib/plans';
import { CATCHCOPY, SERVICE_NAME } from '@/lib/brand';

const yen = (n: number) => n.toLocaleString('ja-JP');
// デモ動画は public/demo.mp4 に置くと表示される（ない間は案内の箱を出す）
const hasDemo = fs.existsSync(path.join(process.cwd(), 'public', 'demo.mp4'));
const minPrice = Math.min(...Object.values(PLANS).map((p) => p.monthlyPriceJpy));

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* 1. トップ */}
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <h1>
                タオバオから<span style={{ whiteSpace: 'nowrap' }}><em>BUYMA</em>へ、</span>
                <br />
                出品1件3分
              </h1>
              <p>
                タオバオ・天猫の商品ページでボタンを1回押すだけ。商品説明もAIが日本語で書くので、一から文章を考える必要はありません。商品名・販売価格・画像も、まとめて用意できます。
              </p>
              <div className="hero-actions">
                <Link href="/login?mode=signup" className="btn">
                  {TRIAL_DAYS}日間 無料で試す
                </Link>
                <Link href="#pricing" className="btn btn-ghost">
                  料金を見る
                </Link>
              </div>
              <p className="small muted">
                クレジットカードの登録なしで始められます（{TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで）。月額{yen(minPrice)}円から。
              </p>
            </div>
            <div className="demo-box" aria-label="デモ動画">
              {hasDemo ? (
                <video src="/demo.mp4" controls muted playsInline preload="metadata" aria-label={`${SERVICE_NAME}のデモ動画`} />
              ) : (
                <div className="demo-fallback">
                  <span className="demo-play" aria-hidden="true">▶</span>
                  <span>デモ動画（準備中）</span>
                  <span className="small">ボタン1回で出品データができるまで</span>
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
                <strong>商品説明を書くのが大変</strong>
                <br />
                中国語の仕様を読み解いて、素材やサイズ感の説明を1件ずつ考えている
              </li>
              <li>
                <strong>価格計算が面倒</strong>
                <br />
                為替・送料・手数料・利益を、毎回電卓や表計算で計算している
              </li>
              <li>
                <strong>画像の保存が手間</strong>
                <br />
                商品画像を1枚ずつ保存して、名前を付けて、サイズを直している
              </li>
            </ul>
          </div>
        </section>

        {/* 3. 解決 */}
        <section className="section">
          <div className="container">
            <h2>ボタン1回で、ぜんぶできます</h2>
            <p className="section-lead">やることは3ステップだけ。</p>
            <ol className="steps">
              <li>
                <h3>商品ページを開く</h3>
                <p>いつものように、タオバオ・天猫で仕入れたい商品のページを開きます。</p>
              </li>
              <li>
                <h3>ボタンを押す</h3>
                <p>Chromeのボタンを押すと、商品名・価格・色・サイズ・画像を読み取り、AIが商品名と説明文を日本語で書きます。</p>
              </li>
              <li>
                <h3>確認してBUYMAへ</h3>
                <p>内容を確認したら、BUYMAへの入力や下書き保存も自動でできます。CSVや画像ZIPでの書き出しにも対応しています。</p>
              </li>
            </ol>
          </div>
        </section>

        {/* 4. 機能の紹介 */}
        <section className="section section-soft" id="features">
          <div className="container">
            <h2>機能の紹介</h2>
            <p className="section-lead">出品に必要な作業を、1つのツールでまとめて。</p>
            <div className="grid grid-3">
              <div className="feature feature-main">
                <h3>商品説明をAIが作成</h3>
                <p>
                  素材・デザイン・サイズ感が伝わる説明文を、自然な日本語で作ります。中国語・英語・韓国語・イタリア語・フランス語など、元の言語は問いません。言い回しは「ていねい」「カジュアル」から選べます。自分で手を入れるのは、気になるところを直すときだけです。
                </p>
              </div>
              <div className="feature">
                <h3>商品名も自動で</h3>
                <p>BUYMAの文字数に収まる、検索されやすい商品名を作ります。</p>
              </div>
              <div className="feature">
                <h3>販売価格を自動計算</h3>
                <p>仕入れ値・為替・送料・手数料・利益率から販売価格を計算します。為替は毎日自動で更新され、固定することもできます。</p>
              </div>
              <div className="feature">
                <h3>説明文テンプレート</h3>
                <p>配送日数・関税・注意事項などの決まった文章を保存しておくと、AIが書いた説明文の後ろに自動で付きます。</p>
              </div>
              <div className="feature">
                <h3>禁止ワードのチェック</h3>
                <p>誇大な表現や、偽物を思わせる言葉、ブランド名の扱いを出品前にお知らせします。</p>
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
              出品件数に合わせて選べる段階制。月額{yen(minPrice)}円から、年払いなら2か月分お得です。
            </p>
            <div className="notice" style={{ marginBottom: 16 }}>
              <strong>まずは無料：</strong>
              {TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで、すべての機能を試せます（カード登録なし）。{' '}
              <Link href="/login?mode=signup">無料で始める</Link>
            </div>
            <div className="price-grid">
              {Object.values(PLANS).map((p) => (
                <div key={p.id} className={`price-card${p.highlight ? ' highlight' : ''}`}>
                  {p.highlight && <span className="price-tag">おすすめ</span>}
                  <h3>{p.name}</h3>
                  <div className="price-amount">
                    {yen(p.monthlyPriceJpy)}
                    <small>円／月</small>
                  </div>
                  <p className="small muted">
                    年払い {yen(p.yearlyPriceJpy)}円（2か月分お得）
                  </p>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <Link href="/login?mode=signup" className={p.highlight ? 'btn' : 'btn btn-ghost'}>
                    無料で試してから選ぶ
                  </Link>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>
              月1,000件を超える場合は、<Link href="/contact">お問い合わせ</Link>から個別にご相談ください。価格はすべて税込です。
            </p>
            <div className="notice" style={{ marginTop: 16 }}>
              <strong>紹介制度：</strong>お友だちを紹介すると、紹介した人もされた人も1か月無料になります。
            </div>
          </div>
        </section>

        {/* 6. よくある質問 */}
        <section className="section section-soft">
          <div className="container">
            <h2>よくある質問</h2>
            <dl className="faq">
              <dt>パソコンに詳しくなくても使えますか？</dt>
              <dd>Chromeに拡張機能を追加するだけです。あとは商品ページでボタンを押すだけで使えます。</dd>
              <dt>BUYMAやタオバオの公式ツールですか？</dt>
              <dd>いいえ、公式ツールではありません。BUYMAの規約を守ってご利用ください。</dd>
              <dt>解約はいつでもできますか？</dt>
              <dd>はい。管理画面からいつでも解約できます。解約後も期間の終わりまで使えます。</dd>
              <dt>商品画像はそのまま使ってもいいですか？</dt>
              <dd>仕入れ先の画像には著作権があります。ご自身で撮影した画像への差し替えをおすすめしています。</dd>
            </dl>
            <p style={{ marginTop: 20 }}>
              <Link href="/faq">よくある質問をもっと見る →</Link>
            </p>
          </div>
        </section>

        {/* 7. 無料お試しの登録 */}
        <section className="section">
          <div className="container">
            <div className="cta-band">
              <h2>まずは無料で、1件3分を体験してください</h2>
              <p>
                {TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで無料。クレジットカードの登録は不要です。
              </p>
              <Link href="/login?mode=signup" className="btn">
                無料お試しに登録する
              </Link>
              <p className="small muted" style={{ marginTop: 12 }}>
                はじめての方は <Link href="/guide">BUYMAの始め方 無料ガイド</Link> もどうぞ。
              </p>
            </div>
          </div>
        </section>
        <p className="container small muted">{CATCHCOPY}</p>
      </main>
      <SiteFooter />
    </>
  );
}
