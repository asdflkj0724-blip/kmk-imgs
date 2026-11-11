'use client';
import { useState } from 'react';

export default function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), message: form.get('message') }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || '送信できませんでした');
      setState('done');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '送信できませんでした');
      setState('error');
    }
  }

  if (state === 'done') {
    return <p className="notice">送信しました。内容を確認のうえ、メールでお返事します。</p>;
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label htmlFor="name">お名前</label>
        <input id="name" name="name" maxLength={100} autoComplete="name" />
      </div>
      <div className="form-row">
        <label htmlFor="email">メールアドレス（必須）</label>
        <input id="email" name="email" type="email" required maxLength={200} autoComplete="email" />
      </div>
      <div className="form-row">
        <label htmlFor="message">お問い合わせ内容（必須）</label>
        <textarea id="message" name="message" required rows={7} maxLength={5000} />
      </div>
      <button className="btn" type="submit" disabled={state === 'sending'} style={{ marginTop: 12 }}>
        {state === 'sending' ? '送信中…' : '送信する'}
      </button>
      {state === 'error' && <p className="form-msg error">{message}</p>}
    </form>
  );
}
