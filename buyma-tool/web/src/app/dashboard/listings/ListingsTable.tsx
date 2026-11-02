'use client';
import { useMemo, useState } from 'react';
import { STATUS_LABELS } from '@/lib/csv';
import type { Issue } from '@/lib/listingRules';

export interface ListingItem {
  id: string;
  title_ja: string | null;
  description_ja: string | null;
  price_jpy: number | null;
  status: string;
  status_note: string | null;
  image_urls: string[];
  source_url: string | null;
  issues: Issue[];
  created_at: string;
}

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '失敗しました');
  return data;
}

export function ListingsTable({ initial }: { initial: ListingItem[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ListingItem | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const shown = useMemo(() => (filter ? items.filter((i) => i.status === filter) : items), [items, filter]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function setStatus(id: string, status: string) {
    try {
      const { listing } = await api(`/api/listings/${id}`, 'PATCH', { status });
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...listing } : x)));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm('この出品データを削除しますか？')) return;
    try {
      await api(`/api/listings/${id}`, 'DELETE');
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      const { listing } = await api(`/api/listings/${editing.id}`, 'PATCH', {
        title: editing.title_ja ?? '',
        description: editing.description_ja ?? '',
        ...(editing.price_jpy ? { priceJpy: editing.price_jpy } : {}),
      });
      setItems((xs) => xs.map((x) => (x.id === editing.id ? { ...x, ...editing, ...listing } : x)));
      setEditing(null);
      setMsg('保存しました');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const csvHref = selected.size
    ? `/api/listings/csv?ids=${[...selected].join(',')}`
    : `/api/listings/csv${filter ? `?status=${filter}` : ''}`;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="状態で絞り込む">
          <option value="">すべて</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <a className="btn" href={csvHref}>
          CSVをダウンロード{selected.size ? `（${selected.size}件）` : ''}
        </a>
      </div>
      {msg && <p className="notice small">{msg}</p>}

      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label htmlFor="ed-title">商品名（{Array.from(editing.title_ja ?? '').length}文字）</label>
          <input id="ed-title" value={editing.title_ja ?? ''} onChange={(e) => setEditing({ ...editing, title_ja: e.target.value })} />
          <label htmlFor="ed-desc">商品コメント</label>
          <textarea id="ed-desc" rows={10} value={editing.description_ja ?? ''} onChange={(e) => setEditing({ ...editing, description_ja: e.target.value })} />
          <label htmlFor="ed-price">販売価格（円）</label>
          <input
            id="ed-price"
            type="number"
            min={1}
            value={editing.price_jpy ?? ''}
            onChange={(e) => setEditing({ ...editing, price_jpy: e.target.value ? Number(e.target.value) : null })}
          />
          <p className="row">
            <button className="btn" onClick={saveEdit}>保存</button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>やめる</button>
          </p>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="選択" />
              <th>画像</th>
              <th>商品名</th>
              <th>価格</th>
              <th>状態</th>
              <th>作成日</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const errors = (r.issues ?? []).filter((i) => i.level === 'error').length;
              const warnings = (r.issues ?? []).filter((i) => i.level === 'warning').length;
              return (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="選ぶ" style={{ width: 'auto' }} />
                  </td>
                  <td>{r.image_urls?.[0] ? <img className="thumb" src={r.image_urls[0]} alt="" referrerPolicy="no-referrer" /> : null}</td>
                  <td style={{ minWidth: 220 }}>
                    {r.title_ja}
                    <div className="small">
                      {errors > 0 && <span className="error">要修正 {errors} </span>}
                      {warnings > 0 && <span className="warn">注意 {warnings} </span>}
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noreferrer noopener">
                          仕入れ先
                        </a>
                      )}
                    </div>
                    {r.status_note && <div className="small muted">{r.status_note}</div>}
                  </td>
                  <td>{r.price_jpy ? `¥${r.price_jpy.toLocaleString()}` : '—'}</td>
                  <td>
                    <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)} style={{ width: 'auto' }} aria-label="状態">
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">{r.created_at.slice(0, 10)}</td>
                  <td>
                    <div className="row">
                      <button className="btn btn-ghost" onClick={() => setEditing(r)}>直す</button>
                      <button className="btn btn-ghost" onClick={() => remove(r.id)}>削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!shown.length && <p className="muted">まだありません。</p>}
    </>
  );
}
