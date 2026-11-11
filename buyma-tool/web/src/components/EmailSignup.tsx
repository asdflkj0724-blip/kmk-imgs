'use client';
import { useId, useState } from 'react';

/**
 * メール登録（ホームページの主役のボタン）。登録されたメールは Supabase の leads に保存し、
 * 登録後は「ありがとう」を表示する。
 */
export default function EmailSignup({ source = 'waitlist', compact = false }: { source?: 'waitlist' | 'guide'; compact?: boolean }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // 人には見えない欄（機械的な登録よけ）
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '登録できませんでした');
      setState('done');
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div className="signup-thanks" role="status">
        <strong>ご登録ありがとうございます。</strong>
        <br />
        無料お試しの準備ができしだい、ご登録のメールアドレスにご案内をお送りします。
      </div>
    );
  }

  return (
    <form className={`signup${compact ? ' signup-compact' : ''}`} onSubmit={submit}>
      <label htmlFor={`${id}-email`} className="visually-hidden">
        メールアドレス
      </label>
      <input
        id={`${id}-email`}
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="visually-hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <button className="btn" disabled={state === 'busy'}>
        {state === 'busy' ? '送信中…' : '無料お試しに登録する'}
      </button>
      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <p className="small muted signup-note">メールアドレスだけで登録できます。カードの登録はいりません。</p>
    </form>
  );
}
