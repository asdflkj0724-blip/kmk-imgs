'use client';
import { useState } from 'react';

export function BillingButtons(props: { mode: 'checkout'; plan: string } | { mode: 'portal' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(path: string, body?: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || '失敗しました');
      location.href = data.url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (props.mode === 'portal') {
    return (
      <>
        <button className="btn btn-ghost" disabled={busy} onClick={() => go('/api/stripe/portal')}>
          お支払いの管理（カード変更・プラン変更・解約）
        </button>
        {err && <p className="error small">{err}</p>}
      </>
    );
  }
  return (
    <>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => go('/api/stripe/checkout', { plan: props.plan, interval: 'month' })}>
          月払いで申し込む
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => go('/api/stripe/checkout', { plan: props.plan, interval: 'year' })}>
          年払い
        </button>
      </div>
      {err && <p className="error small">{err}</p>}
    </>
  );
}
