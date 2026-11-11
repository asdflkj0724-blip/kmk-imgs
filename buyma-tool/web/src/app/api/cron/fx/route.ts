/** 毎日の為替更新（vercel.json の crons から呼ばれる） */
import { fetchRates } from '@/lib/fx';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const quotes = await fetchRates();
    const now = new Date().toISOString();
    // 列名 cny_jpy は昔の名残（中身は「その通貨1単位＝何円」）
    const { error } = await supabaseAdmin()
      .from('fx_rates')
      .upsert(quotes.map((q) => ({ date: q.date, currency: q.currency, cny_jpy: q.rate, source: q.source, fetched_at: now })));
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, quotes });
  } catch (e) {
    console.error('fx update failed', e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
