/** お支払いの管理（カード変更・プラン変更・解約）は Stripe の画面で行う */
import { getRequestUser } from '@/lib/auth';
import { getProfile } from '@/lib/account';
import { stripe } from '@/lib/stripe';
import { siteUrl } from '@/lib/http';

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: 'ログインしてください' }, { status: 401 });
  const profile = await getProfile(user.id);
  if (!profile.stripe_customer_id) return Response.json({ error: 'まだお申し込みがありません' }, { status: 400 });
  const session = await stripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${siteUrl()}/dashboard/billing`,
    locale: 'ja',
  });
  return Response.json({ url: session.url });
}
