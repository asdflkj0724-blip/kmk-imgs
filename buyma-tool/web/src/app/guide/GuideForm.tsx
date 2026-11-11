'use client';
import Link from 'next/link';
import { useState } from 'react';

export default function GuideForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    setState('sending');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: 'guide' }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || '登録できませんでした');
      setState('done');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '登録できませんでした');
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="notice">
        <p style={{ marginTop: 0 }}>ありがとうございます。ガイドはこちらから読めます（PDFとしても保存できます）。</p>
        <Link href="/guide/read" className="btn">
          ガイドを読む
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="guide-email">メールアドレス</label>
      <input id="guide-email" name="email" type="email" required maxLength={200} autoComplete="email" />
      <button className="btn" type="submit" disabled={state === 'sending'} style={{ marginTop: 12 }}>
        {state === 'sending' ? '送信中…' : '無料でガイドを受け取る'}
      </button>
      {state === 'error' && <p className="form-msg error">{message}</p>}
      <p className="small muted">
        ご登録のメールアドレスに、{'BUYMA'}出品に役立つ情報や本サービスのご案内をお送りすることがあります。いつでも停止できます。
      </p>
    </form>
  );
}
