'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

/** パスワードを決める・忘れたときのメールを送る（ホームページから申し込んだ人も、ここで最初のパスワードを決める） */
export function ResetForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent('/dashboard/password')}`,
    });
    if (error) {
      setState('idle');
      setError('送れませんでした。時間をおいてもう一度お試しください。');
      return;
    }
    setState('sent');
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: '1.4rem', marginTop: 0 }}>パスワードの設定・再設定</h1>
      {state === 'sent' ? (
        <p className="notice">
          メールを送りました。メールのリンクを開くと、パスワードを決める画面になります。届かないときは、迷惑メールのフォルダもご確認ください。
        </p>
      ) : (
        <form onSubmit={submit}>
          <p className="small muted" style={{ marginTop: 0 }}>
            ご登録のメールアドレスに、パスワードを決めるためのリンクを送ります。ホームページからお申し込みいただいた方も、こちらから最初のパスワードを決めてください。
          </p>
          <label htmlFor="reset-email">メールアドレス</label>
          <input id="reset-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p>
            <button className="btn" style={{ width: '100%' }} disabled={state === 'busy'}>
              {state === 'busy' ? '送信中…' : 'メールを送る'}
            </button>
          </p>
          {error && <p className="error small">{error}</p>}
        </form>
      )}
      <p className="small">
        <a href="/login">ログインに戻る</a>
      </p>
    </div>
  );
}
