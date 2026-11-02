'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

type ChromeRuntime = { runtime?: { sendMessage?: (id: string, msg: unknown, cb: (res: unknown) => void) => void; lastError?: { message?: string } } };

export function ConnectExtension({ extensionId, apiBase }: { extensionId: string; apiBase: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  async function connect() {
    setState('busy');
    const { data } = await supabaseBrowser().auth.getSession();
    const s = data.session;
    const chrome = (globalThis as unknown as { chrome?: ChromeRuntime }).chrome;
    // 拡張機能の設定画面から開いた場合は、その拡張の ID を使う（開発中の拡張は ID がパソコンごとに違う）
    const fromUrl = new URLSearchParams(location.search).get('ext') || '';
    const targetId = /^[a-p]{32}$/.test(fromUrl) ? fromUrl : extensionId;
    if (!s) {
      setState('error');
      return setMsg('ログインが切れています。もう一度ログインしてください。');
    }
    if (!targetId || !chrome?.runtime?.sendMessage) {
      setState('error');
      return setMsg('拡張機能が見つかりません。Chrome で拡張機能を入れてから、このページを開き直してください。');
    }
    chrome.runtime.sendMessage(
      targetId,
      {
        type: 'BUYMA_AUTH',
        accessToken: s.access_token,
        refreshToken: s.refresh_token,
        expiresAt: s.expires_at,
        apiBase,
        email: s.user.email,
      },
      (res) => {
        const ok = (res as { ok?: boolean } | undefined)?.ok;
        if (ok) {
          setState('done');
          setMsg('つながりました。タオバオの商品ページで拡張のボタンを押してみてください。');
        } else {
          setState('error');
          setMsg('拡張機能が応答しませんでした。拡張機能を最新にして、もう一度お試しください。');
        }
      }
    );
  }

  return (
    <div className="card">
      <button className="btn" onClick={connect} disabled={state === 'busy'}>
        {state === 'done' ? 'もう一度つなぐ' : '拡張機能とつなぐ'}
      </button>
      {msg && <p className={state === 'error' ? 'error' : 'ok'}>{msg}</p>}
    </div>
  );
}
