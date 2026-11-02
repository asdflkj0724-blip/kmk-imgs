/** Stripe からの通知を受けて、プランの状態をデータベースに反映する */
import type Stripe from 'stripe';
import { customerId, referralCreditJpy, stripe, subscriptionToProfile } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get('stripe-signature');
  if (!secret || !sig) return new Response('missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return new Response('bad signature', { status: 400 });
  }

  const db = supabaseAdmin();
  // 同じ通知が2回来ても1回だけ処理する
  const { error: dup } = await db.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup) return Response.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.client_reference_id;
        const cust = customerId(s.customer);
        if (userId && cust) await db.from('profiles').update({ stripe_customer_id: cust }).eq('id', userId);
        if (typeof s.subscription === 'string') {
          await applySubscription(await stripe().subscriptions.retrieve(s.subscription));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object);
        break;
      case 'invoice.paid':
        await rewardReferrer(event.data.object);
        break;
    }
  } catch (e) {
    // 失敗したら記録を消して、Stripe にもう一度送ってもらう
    await db.from('stripe_events').delete().eq('id', event.id);
    console.error('stripe webhook failed', event.type, e);
    return new Response('handler failed', { status: 500 });
  }
  return Response.json({ received: true });
}

async function applySubscription(sub: Stripe.Subscription) {
  const db = supabaseAdmin();
  const update = subscriptionToProfile(sub);
  const cust = customerId(sub.customer);
  const userId = sub.metadata?.user_id;
  const q = db.from('profiles').update({ ...update, stripe_customer_id: cust });
  const { error } = userId ? await q.eq('id', userId) : await q.eq('stripe_customer_id', cust);
  if (error) throw new Error(error.message);
}

/** 紹介で来た人が初めてお金を払ったら、紹介した人に1か月分を差し引く */
async function rewardReferrer(invoice: Stripe.Invoice) {
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return;
  const db = supabaseAdmin();
  const cust = customerId(invoice.customer);
  if (!cust) return;
  const { data: payer } = await db
    .from('profiles')
    .select('id, referred_by, referral_rewarded')
    .eq('stripe_customer_id', cust)
    .maybeSingle();
  if (!payer?.referred_by || payer.referral_rewarded) return;
  const { data: referrer } = await db
    .from('profiles')
    .select('id, plan, stripe_customer_id')
    .eq('id', payer.referred_by)
    .maybeSingle();
  if (!referrer?.stripe_customer_id) return; // 紹介した人がまだ有料でなければ、お礼はなし（必要なら手動で）
  await stripe().customers.createBalanceTransaction(referrer.stripe_customer_id, {
    amount: -referralCreditJpy(referrer.plan),
    currency: 'jpy',
    description: '紹介特典（1か月分）',
  });
  await db.from('profiles').update({ referral_rewarded: true }).eq('id', payer.id);
}
