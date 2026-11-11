'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function PasswordForm() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg('パスワードは8文字以上にしてください。');
    if (password !== again) return setMsg('2回入れたパスワードが違います。');
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg('保存できませんでした。メールのリンクからもう一度お試しください。');
    setMsg('パスワードを保存しました。');
    setTimeout(() => router.push('/dashboard'), 1200);
  }

  return (
    <form className="card" style={{ maxWidth: 440 }} onSubmit={submit}>
      <label htmlFor="pw">新しいパスワード（8文字以上）</label>
      <input id="pw" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      <label htmlFor="pw2">もう一度</label>
      <input id="pw2" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
      <p>
        <button className="btn" disabled={busy}>{busy ? '保存中…' : '保存する'}</button>
      </p>
      {msg && <p className="notice small">{msg}</p>}
    </form>
  );
}
