import type { Metadata } from 'next';
import '../../marketing.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { PLANS, TRIAL_DAYS, TRIAL_LIMIT } from '@/lib/plans';
import { SERVICE_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: '特定商取引法に基づく表記' };

const yen = (n: number) => n.toLocaleString('ja-JP');

export default function TokushohoPage() {
  const env = (v: string | undefined, label: string) => v || `（${label}：準備中）`;
  const rows: [string, React.ReactNode][] = [
    ['販売事業者', env(process.env.NEXT_PUBLIC_SELLER_NAME, '販売事業者名')],
    ['運営責任者', env(process.env.NEXT_PUBLIC_SELLER_MANAGER, '運営責任者')],
    ['所在地', env(process.env.NEXT_PUBLIC_SELLER_ADDRESS, '所在地')],
    ['電話番号', env(process.env.NEXT_PUBLIC_SELLER_PHONE, '電話番号')],
    ['メールアドレス', env(process.env.NEXT_PUBLIC_SELLER_EMAIL, 'メールアドレス')],
    ['サービス名', SERVICE_NAME],
    [
      '販売価格',
      <>
        {Object.values(PLANS).map((p) => (
          <div key={p.id}>
            {p.name}：月額{yen(p.monthlyPriceJpy)}円／年額{yen(p.yearlyPriceJpy)}円（税込・月{yen(p.monthlyLimit)}件まで）
          </div>
        ))}
        <div>月2,000件を超えるご利用は個別にお見積もりします。</div>
      </>,
    ],
    ['商品代金以外の必要料金', 'インターネット接続にかかる通信料はお客様のご負担です。'],
    ['支払方法', 'クレジットカード（決済代行：Stripe）'],
    [
      '支払時期',
      `無料お試し（${TRIAL_DAYS}日間 または ${TRIAL_LIMIT}件まで）のあと、有料プランに申し込んだ時点で初回のお支払いが発生します。以降は月払いなら毎月、年払いなら毎年、同じ日に自動で更新・請求されます。`,
    ],
    ['提供時期', 'お支払いの手続きが完了した時点から、すぐにご利用いただけます。'],
    [
      '解約・返金',
      '解約は管理画面からいつでも手続きできます。解約後も、お支払い済みの期間の終わりまでご利用いただけます。サービスの性質上、お支払い済みの料金の返金（日割りを含む）はいたしません。ただし、当方の不具合により長期間ご利用いただけなかった場合は個別に対応します。',
    ],
    ['動作環境', 'パソコン版 Google Chrome（最新版）。スマートフォン・タブレットには対応していません。'],
  ];
  return (
    <>
      <SiteHeader />
      <main className="prose">
        <p className="draft-note">公開前に専門家の確認を受けてください（たたき台）</p>
        <h1>特定商取引法に基づく表記</h1>
        <div className="table-wrap">
          <table className="kv-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          電話番号などは、ご請求があった場合に遅滞なく開示することがあります。お問い合わせはメールにてお願いします。
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
