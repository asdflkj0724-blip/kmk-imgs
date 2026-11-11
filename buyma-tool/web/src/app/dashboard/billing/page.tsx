import { requireSession } from '../session';
import { getAllowance, planName } from '@/lib/account';
import { PLANS, TRIAL_LIMIT } from '@/lib/plans';
import { BillingButtons } from './BillingButtons';
import { SITE } from '@/site.config';

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  const sp = await searchParams;
  const allowance = await getAllowance(profile);
  const subscribed = !!profile.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(profile.subscription_status || '');

  return (
    <>
      <h1>プラン・お支払い</h1>
      {sp.success && <p className="notice">お申し込みありがとうございます。反映まで数秒かかることがあります。</p>}
      {profile.subscription_status === 'past_due' && <p className="notice error">お支払いが確認できていません。「お支払いの管理」からカードを更新してください。</p>}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="muted small">今のプラン</div>
        <div className="stat">{planName(profile)}</div>
        <p className="small">
          {profile.plan === 'trial'
            ? `お試し：${allowance.used} / ${TRIAL_LIMIT} 件${profile.trial_ends_at ? `、${profile.trial_ends_at.slice(0, 10)} まで` : ''}`
            : `今月 ${allowance.used} / ${allowance.limit} 件${profile.current_period_end ? `・次回の更新 ${profile.current_period_end.slice(0, 10)}` : ''}${profile.billing_interval === 'year' ? '（年払い）' : ''}`}
        </p>
        {profile.stripe_customer_id && <BillingButtons mode="portal" />}
      </div>

      {!subscribed && (
        <div className="grid grid-3">
          {Object.values(PLANS).map((p) => (
            <div key={p.id} className={`card plan-card${p.highlight ? ' current' : ''}`}>
              {p.highlight && <span className="badge">おすすめ</span>}
              <h2 style={{ margin: '8px 0 0' }}>{p.name}</h2>
              <div className="stat">
                ¥{p.monthlyPriceJpy.toLocaleString()}
                <span className="small muted"> / 月</span>
              </div>
              <div className="small muted">年払いなら ¥{p.yearlyPriceJpy.toLocaleString()}（2か月分お得）</div>
              <ul className="small">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <BillingButtons mode="checkout" plan={p.id} />
            </div>
          ))}
        </div>
      )}
      <p className="muted small">月{SITE.customAbove.toLocaleString('ja-JP')}件を超えて使いたい場合は、お問い合わせから個別にご相談ください。解約は「お支払いの管理」からいつでもできます。</p>
    </>
  );
}
