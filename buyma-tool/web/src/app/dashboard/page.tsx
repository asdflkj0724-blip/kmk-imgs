import Link from 'next/link';
import { requireSession } from './session';
import { getAllowance, fxFor, planName } from '@/lib/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/http';
import { STATUS_LABELS } from '@/lib/csv';
import { CopyButton } from './CopyButton';

export default async function DashboardHome() {
  const { profile } = await requireSession();
  const db = supabaseAdmin();
  const [allowance, fx, recent, templates] = await Promise.all([
    getAllowance(profile),
    fxFor(profile),
    db.from('listings').select('id, title_ja, price_jpy, status, created_at').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(5),
    db.from('templates').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
  ]);
  const pct = allowance.limit ? Math.min(100, Math.round((allowance.used / allowance.limit) * 100)) : 100;
  const refLink = `${siteUrl()}/login?mode=signup&ref=${profile.referral_code}`;
  const trialLeft =
    profile.plan === 'trial' && profile.trial_ends_at
      ? Math.max(0, Math.ceil((new Date(profile.trial_ends_at).getTime() - Date.now()) / 86400_000))
      : null;

  return (
    <>
      <h1>ホーム</h1>
      {!allowance.allowed && allowance.reason && (
        <p className="notice">
          {allowance.reason} <Link href="/dashboard/billing">プランを見る</Link>
        </p>
      )}
      <div className="grid grid-3">
        <div className="card">
          <div className="muted small">今のプラン</div>
          <div className="stat">{planName(profile)}</div>
          {trialLeft !== null && <div className="small">お試し残り {trialLeft} 日</div>}
        </div>
        <div className="card">
          <div className="muted small">{profile.plan === 'trial' ? 'お試しで使った件数' : '今月使った件数'}</div>
          <div className="stat">
            {allowance.used} <span className="small muted">/ {allowance.limit} 件</span>
          </div>
          <div className="meter" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="card">
          <div className="muted small">今日の為替（人民元→円）</div>
          <div className="stat">{fx ? fx.rate.toFixed(2) : '—'}</div>
          <div className="small muted">{fx ? (fx.source === 'fixed' ? '固定レート' : `${fx.date} の自動レート`) : 'まだ取得していません'}</div>
        </div>
      </div>

      <h2>はじめの準備</h2>
      <ol className="steps">
        <li>Chrome 拡張を入れる（配布方法は案内メールをご覧ください）</li>
        <li>
          <Link href="/extension/connect">拡張とアカウントをつなぐ</Link>
        </li>
        <li>
          <Link href="/dashboard/templates">説明文のテンプレートを確認する</Link>（今 {templates.count ?? 0} 件）
        </li>
        <li>
          <Link href="/dashboard/settings">送料・手数料・利益率を自分の値にする</Link>
        </li>
        <li>タオバオの商品ページで拡張のボタンを押す</li>
      </ol>

      <h2>最近の出品データ</h2>
      {recent.data?.length ? (
        <div className="table-wrap">
          <table>
            <tbody>
              {recent.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.title_ja}</td>
                  <td>{r.price_jpy ? `¥${r.price_jpy.toLocaleString()}` : '—'}</td>
                  <td>
                    <span className="badge">{STATUS_LABELS[r.status] ?? r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">まだありません。</p>
      )}
      <p>
        <Link href="/dashboard/listings">すべて見る →</Link>
      </p>

      <h2>お友だち紹介</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>このリンクから登録した人は1か月無料。その人が有料プランを始めると、あなたも1か月分が無料になります。</p>
        <div className="row">
          <input readOnly value={refLink} style={{ flex: 1, minWidth: 0 }} />
          <CopyButton text={refLink} />
        </div>
      </div>
    </>
  );
}
