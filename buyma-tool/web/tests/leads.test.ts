import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ upsert }) }) }));

const post = (body: unknown) =>
  new Request('http://localhost/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('メール登録（ホームページ）', async () => {
  const { POST } = await import('@/app/api/leads/route');
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it('メールを小文字にそろえて保存し、2回目は重ねない', async () => {
    const res = await POST(post({ email: ' Taro@Example.com ', source: 'waitlist' }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ email: 'taro@example.com', source: 'waitlist' }, { onConflict: 'email,source', ignoreDuplicates: true });
  });
  it('メールアドレスがおかしければ断る', async () => {
    expect((await POST(post({ email: 'not-an-email' }))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('見えない欄に書き込む機械的な登録は、成功したふりをして保存しない', async () => {
    const res = await POST(post({ email: 'bot@example.com', source: 'waitlist', website: 'http://spam' }));
    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });
  it('知らない申し込み元は受け付けない', async () => {
    expect((await POST(post({ email: 'a@example.com', source: 'hack' }))).status).toBe(400);
  });
});
