'use client';
import { useState } from 'react';

/** 申し込み・購入ボタン（小さめ）。Stripe の申込ページへ進む */
export default function BuyButton({ plan, label = '申し込む', interval = 'month' }: { plan: string; label?: string; interval?: 'month' | 'year' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'お申し込みページを開けませんでした');
      location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="buy-link" onClick={go} disabled={busy}>
        {busy ? '移動中…' : label}
      </button>
      {error && <span className="error small">{error}</span>}
    </>
  );
}
