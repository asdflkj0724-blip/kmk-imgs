'use client';
/** 【テスト専用】Sonnet と Haiku の比較を実行し、結果をファイルに保存する画面。本番では API が 404 を返すので動かない */
import { useState } from 'react';

type Row = Record<string, unknown>;
const BUDGET_JPY = 45; // これを超えそうなら止める（目安30円＋余裕）
const JPY = 155;

export default function TestCompare() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('まだ実行していません');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function call(body: object): Promise<Row> {
    const res = await fetch('/api/test-compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 404) throw new Error('この画面は本番では使えません');
    return res.json();
  }

  async function run() {
    const cacheMode = new URLSearchParams(location.search).get('mode') === 'cache';
    setRunning(true);
    const out: Row[] = [];
    let spent = 0;
    try {
      if (!cacheMode) {
        setStatus('修正前のエラー確認中…');
        out.push({ check: 'haiku-before-fix', ...(await call({ index: 0, model: 'haiku-before-fix' })) });
      }
      const models = cacheMode ? (['sonnet-cache'] as const) : (['sonnet', 'haiku'] as const);
      for (let i = 0; i < 10; i++) {
        for (const model of models) {
          if (spent * JPY > BUDGET_JPY) throw new Error(`費用が目安を超えそうなので止めました（約${Math.round(spent * JPY)}円）`);
          setStatus(`${i + 1}/10件目・${model} を実行中…（ここまで約${(spent * JPY).toFixed(1)}円）`);
          const r = await call({ index: i, model });
          spent += Number(r.usd ?? 0);
          out.push(r);
          setRows([...out]);
        }
      }
      setStatus(`完了しました（合計 約${(spent * JPY).toFixed(1)}円）。下のボタンで結果を保存して、チャットに送ってください`);
      setDone(true);
    } catch (e) {
      setStatus((e as Error).message);
      setDone(out.length > 0);
    }
    setRows(out);
    setRunning(false);
  }

  function save() {
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'compare-result.json';
    a.click();
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'sans-serif' }}>
      <meta name="robots" content="noindex" />
      <h1>AI比較テスト（テスト専用）</h1>
      <p>同じ10件の商品で、今のAI（Sonnet）と安いAI（Haiku）の文章を作って比べます。費用の目安は約30円です。ボタンは1回だけ押してください。</p>
      <p>
        <button onClick={run} disabled={running || done} style={{ padding: '10px 20px', fontSize: 16 }}>テストを開始</button>{' '}
        <button onClick={save} disabled={!done} style={{ padding: '10px 20px', fontSize: 16 }}>結果を保存</button>
      </p>
      <p><b>{status}</b></p>
      <ol>
        {rows.filter((r) => r.index !== undefined).map((r, k) => (
          <li key={k}>
            {Number(r.index) + 1}件目 {String(r.requested ?? '')}：{r.ok ? `${(Number(r.ms) / 1000).toFixed(1)}秒・約${(Number(r.usd) * JPY).toFixed(2)}円` : `エラー（${String(r.message ?? '')}）`}
          </li>
        ))}
      </ol>
    </main>
  );
}
