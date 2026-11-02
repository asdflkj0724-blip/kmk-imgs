import type { Metadata } from 'next';
import Link from 'next/link';
import '../../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import PrintButton from './PrintButton';
import { SERVICE_NAME } from '@/lib/brand';
import { TRIAL_DAYS, TRIAL_LIMIT } from '@/lib/plans';

export const metadata: Metadata = { title: 'BUYMAの始め方ガイド', robots: { index: false } };

export default function GuideReadPage() {
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <p className="no-print">
          <PrintButton />
          <span className="small muted" style={{ marginLeft: 8 }}>
            印刷画面で「送信先：PDFに保存」を選ぶとPDFになります
          </span>
        </p>
        <h1>BUYMAの始め方ガイド</h1>
        <p className="muted">はじめての方向け／タオバオ仕入れ編</p>

        <h2>1. BUYMAショッパー登録の流れ</h2>
        <p>BUYMAでは、海外の商品を買い付けて販売する人を「パーソナルショッパー」と呼びます。登録料・出品料はかからず、売れたときに手数料がかかるしくみです。</p>
        <ol>
          <li>BUYMAに会員登録する（メールアドレスで登録）</li>
          <li>マイページからショッパー登録をする（本人確認、売上の振込先口座を登録）</li>
          <li>プロフィール・配送方法・お届け日数などを設定する</li>
          <li>商品を出品する</li>
        </ol>
        <p>登録に必要な情報や手数料は変わることがあります。最新の内容は必ずBUYMAの公式ヘルプで確認してください。</p>

        <h2>2. タオバオ仕入れの基本</h2>
        <h3>受注してから買い付ける</h3>
        <p>BUYMAでは、注文が入ってから仕入れる「無在庫」の売り方ができます。在庫を抱えないので、始めたばかりでもリスクを小さくできます。</p>
        <h3>代行業者を使う</h3>
        <p>タオバオで買った商品を日本に送るには、中国の代行業者を使うのが一般的です。代行手数料・国内送料・国際送料がかかるので、価格を決めるときに必ず含めます。</p>
        <h3>良いお店の選び方</h3>
        <ul>
          <li>評価が高く、販売の実績が多いお店を選ぶ</li>
          <li>商品ページのレビュー写真（買った人が撮った写真）で、実物の感じを確かめる</li>
          <li>サイズ表や素材がきちんと書かれている商品を選ぶ</li>
          <li>品切れになりやすい商品は、出品前と注文後に在庫を確かめる</li>
        </ul>

        <h2>3. 赤字にならない価格の決め方</h2>
        <p>販売価格は、次の費用をすべて足してから、手数料と利益を乗せて決めます。</p>
        <ul>
          <li>商品の値段（人民元 × 為替レート）</li>
          <li>代行手数料（商品代の数％が多い）</li>
          <li>中国の国内送料・国際送料</li>
          <li>関税・消費税（関税込みで売る場合）</li>
          <li>BUYMAの成約手数料（販売価格に対する率）</li>
        </ul>
        <p>
          考え方の例：費用の合計が6,000円、手数料率が約8％、ほしい利益率が20％なら、販売価格は 6,000 ÷（1 − 0.08 − 0.2）＝ 約8,400円 になります。為替は毎日変わるので、少し余裕を持たせておくと安心です。
        </p>

        <h2>4. 偽物を扱わないための注意</h2>
        <p>タオバオには、有名ブランドの偽物やデザインの写しも多く出品されています。偽物の販売は法律で禁止されており、BUYMAのアカウント停止にもつながります。</p>
        <ul>
          <li>「高仿」「复刻」「原单」「1:1」などの言葉がある商品は偽物の可能性が高いので扱わない</li>
          <li>「同款」「大牌」は「〇〇風」「似たデザイン」の意味。ブランド名を書いて売ってはいけない</li>
          <li>ブランド名は、正規品だと証明できる場合だけ使う</li>
          <li>ロゴが入った商品は特に注意する</li>
        </ul>

        <h2>5. 売れる出品のコツ</h2>
        <ul>
          <li>商品名には「アイテム名・素材・特徴」を入れて、検索されやすくする</li>
          <li>説明文には素材・サイズ感・使う場面を書き、買う人の不安をなくす</li>
          <li>配送日数・関税・注意事項はテンプレートにして、毎回同じ内容を付ける</li>
          <li>画像は、できるだけ自分で撮ったものに差し替える（仕入れ先の画像には著作権があります）</li>
          <li>出品数を増やす。最初は質問やお気に入りの反応を見て、売れる商品の傾向をつかむ</li>
        </ul>

        <h2>出品作業を1件3分に</h2>
        <p>
          {SERVICE_NAME}を使えば、タオバオの商品ページでボタンを1回押すだけで、日本語の商品名・説明文・販売価格ができあがります。{TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで無料で試せます。
        </p>
        <p className="no-print">
          <Link href="/login?mode=signup" className="btn">
            無料お試しに登録する
          </Link>
        </p>
        <p className="small muted">本ガイドの内容は作成時点のものです。BUYMAや各サイトのルールは変わることがあるため、必ず公式の情報を確認してください。</p>
      </main>
      <SiteFooter />
    </>
  );
}
