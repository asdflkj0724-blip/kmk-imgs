'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { TRIAL_DAYS, TRIAL_LIMIT } from '@/lib/plans';

type Mode = 'login' | 'signup';

function safeNext(next?: string) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

/** Supabase のエラーを、わかりやすい日本語にする。わからないものは、原因の英語をそのまま後ろに付ける */
export function loginErrorMessage(m: string): string {
  if (/invalid login/i.test(m)) return 'メールアドレスかパスワードが違います。';
  if (/already registered|already been registered/i.test(m)) return 'このメールアドレスはすでに登録されています。ログインしてください。';
  if (/email not confirmed/i.test(m)) return 'メールアドレスの確認がまだです。届いた確認メールのリンクを押してください。';
  if (/rate limit|too many/i.test(m)) return '短い時間に何度も試したため、しばらく送れません。1時間ほどおいてから、もう一度お試しください。';
  if (/invalid api key|no api key|apikey/i.test(m)) return 'サイトの設定（Supabase のキー）が正しくないようです。運営者にお知らせください。';
  if (/database error/i.test(m)) return '登録の準備（データベース）でエラーが起きました。運営者にお知らせください。';
  if (/signups not allowed|signup is disabled/i.test(m)) return '今は新しい登録を受け付けていません。';
  if (/password/i.test(m)) return 'パスワードは8文字以上にしてください。';
  if (/fetch|network/i.test(m)) return 'サーバーにつながりませんでした。インターネットの接続を確かめて、もう一度お試しください。';
  return `うまくいきませんでした。時間をおいてもう一度お試しください。（詳しい内容：${m || '不明'}）`;
}

export function LoginForm(props: { initialMode: Mode; next?: string; refCode?: string; error?: string }) {
  const [mode, setMode] = useState<Mode>(props.initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(props.error ? 'ログインに失敗しました。もう一度お試しください。' : null);
  const router = useRouter();
  const next = safeNext(props.next);

  // 紹介コードは Google ログインでも使えるように cookie に入れておく（30日）
  useEffect(() => {
    if (props.refCode && /^[a-z0-9]{4,16}$/i.test(props.refCode)) {
      document.cookie = `ref=${props.refCode}; path=/; max-age=${30 * 86400}; samesite=lax`;
    }
  }, [props.refCode]);

  const callback = () => `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    try {
      if (mode === 'signup') {
        const ref = document.cookie.match(/(?:^|; )ref=([^;]+)/)?.[1];
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback(), data: ref ? { ref } : {} },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage('確認メールを送りました。メールのリンクを開くと登録が終わります。');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setMessage(loginErrorMessage((err as Error).message || ''));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    await supabaseBrowser().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback() } });
  }

  return (
    <div className="card">
      <h1 style={{ fontSize: '1.4rem', marginTop: 0 }}>{mode === 'signup' ? '無料で始める' : 'ログイン'}</h1>
      {mode === 'signup' && (
        <p className="muted small">
          {TRIAL_DAYS}日間 または {TRIAL_LIMIT}件まで無料。カードの登録はいりません。
        </p>
      )}
      <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={google}>
        Googleで{mode === 'signup' ? '登録' : 'ログイン'}
      </button>
      <p className="muted small" style={{ textAlign: 'center' }}>または</p>
      <form onSubmit={submit}>
        <label htmlFor="email">メールアドレス</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">パスワード（8文字以上）</label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>
            {busy ? '送信中…' : mode === 'signup' ? '登録する' : 'ログイン'}
          </button>
        </p>
      </form>
      {message && <p className="notice small">{message}</p>}
      <p className="small">
        {mode === 'signup' ? (
          <>すでに登録済みの方は <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>ログイン</a></>
        ) : (
          <>
            はじめての方は <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>無料で登録</a>
            <br />
            <a href="/login/reset">パスワードを忘れた・まだ決めていない</a>
          </>
        )}
      </p>
      {mode === 'signup' && (
        <p className="muted small">
          登録すると <a href="/legal/terms">利用規約</a> と <a href="/legal/privacy">プライバシーポリシー</a> に同意したものとみなします。
        </p>
      )}
    </div>
  );
}
