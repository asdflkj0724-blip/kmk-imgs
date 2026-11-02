/** 毎日の為替更新（vercel.json の crons から呼ばれる） */
import { fetchCnyJpy } from '@/lib/fx';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const q = await fetchCnyJpy();
    const { error } = await supabaseAdmin()
      .from('fx_rates')
      .upsert({ date: q.date, cny_jpy: q.rate, source: q.source, fetched_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, ...q });
  } catch (e) {
    console.error('fx update failed', e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
