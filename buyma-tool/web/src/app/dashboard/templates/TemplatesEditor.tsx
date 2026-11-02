'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

export interface Template {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
}

export function TemplatesEditor({ userId, initial }: { userId: string; initial: Template[] }) {
  const [items, setItems] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const db = supabaseBrowser();

  async function save(t: Template) {
    const { error } = await db.from('templates').update({ name: t.name, body: t.body }).eq('id', t.id);
    setMsg(error ? '保存できませんでした' : `「${t.name}」を保存しました`);
  }

  async function add() {
    const { data, error } = await db
      .from('templates')
      .insert({ user_id: userId, name: '新しいテンプレート', body: '', is_default: items.length === 0 })
      .select('id, name, body, is_default')
      .single();
    if (error || !data) return setMsg('追加できませんでした');
    setItems([...items, data as Template]);
  }

  async function makeDefault(id: string) {
    await db.from('templates').update({ is_default: false }).eq('user_id', userId);
    const { error } = await db.from('templates').update({ is_default: true }).eq('id', id);
    if (!error) setItems(items.map((t) => ({ ...t, is_default: t.id === id })));
  }

  async function remove(id: string) {
    if (!confirm('このテンプレートを削除しますか？')) return;
    const { error } = await db.from('templates').delete().eq('id', id);
    if (!error) setItems(items.filter((t) => t.id !== id));
  }

  const update = (id: string, patch: Partial<Template>) => setItems(items.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <>
      {msg && <p className="notice small">{msg}</p>}
      <div className="grid">
        {items.map((t) => (
          <div className="card" key={t.id}>
            <label htmlFor={`n-${t.id}`}>名前 {t.is_default && <span className="badge">いつも使う</span>}</label>
            <input id={`n-${t.id}`} value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} />
            <label htmlFor={`b-${t.id}`}>本文</label>
            <textarea id={`b-${t.id}`} rows={8} value={t.body} onChange={(e) => update(t.id, { body: e.target.value })} />
            <p className="row">
              <button className="btn" onClick={() => save(t)}>保存</button>
              {!t.is_default && (
                <button className="btn btn-ghost" onClick={() => makeDefault(t.id)}>いつも使うにする</button>
              )}
              <button className="btn btn-ghost" onClick={() => remove(t.id)}>削除</button>
            </p>
          </div>
        ))}
      </div>
      <p>
        <button className="btn btn-ghost" onClick={add}>＋ テンプレートを追加</button>
      </p>
    </>
  );
}
