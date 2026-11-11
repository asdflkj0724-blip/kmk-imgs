/** 毎日の為替更新（vercel.json の crons から呼ばれる） */
import { refreshFxRates } from '@/lib/fxStore';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const quotes = await refreshFxRates();
    return Response.json({ ok: true, quotes });
  } catch (e) {
    console.error('fx update failed', e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
