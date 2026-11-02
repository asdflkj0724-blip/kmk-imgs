/** プランの申し込み：Stripe の支払い画面を作って、その URL を返す */
import { z } from 'zod';
import { getRequestUser } from '@/lib/auth';
import { getProfile } from '@/lib/account';
import { stripePriceId } from '@/lib/plans';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/http';

const Body = z.object({ plan: z.enum(['light', 'standard', 'pro']), interval: z.enum(['month', 'year']) });

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: 'ログインしてください' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'プランの指定が正しくありません' }, { status: 400 });
  const price = stripePriceId(parsed.data.plan, parsed.data.interval);
  if (!price) return Response.json({ error: 'このプランの価格がまだ設定されていません' }, { status: 500 });

  const profile = await getProfile(user.id);
  if (profile.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(profile.subscription_status || '')) {
    return Response.json({ error: 'すでに申し込み済みです。プランの変更は「お支払いの管理」から行えます' }, { status: 409 });
  }

  let customer = profile.stripe_customer_id;
  if (!customer) {
    const c = await stripe().customers.create({ email: profile.email ?? undefined, metadata: { user_id: user.id } });
    customer = c.id;
    await supabaseAdmin().from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
  }

  // 無料お試しの残りがあれば、その日まで請求を始めない（Stripe は 48 時間以上先が必要）
  const trialEnd = profile.trial_ends_at ? Math.floor(new Date(profile.trial_ends_at).getTime() / 1000) : 0;
  const useTrial = profile.plan === 'trial' && trialEnd > Date.now() / 1000 + 48 * 3600;

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: user.id,
    allow_promotion_codes: true,
    subscription_data: { metadata: { user_id: user.id }, ...(useTrial ? { trial_end: trialEnd } : {}) },
    success_url: `${siteUrl()}/dashboard/billing?success=1`,
    cancel_url: `${siteUrl()}/dashboard/billing?canceled=1`,
    locale: 'ja',
  });
  return Response.json({ url: session.url });
}
